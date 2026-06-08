import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Search, RefreshCw, AlertCircle, Clock, FileText, Loader2, CheckCircle2, ArrowUpDown, ArrowUp, ArrowDown, Filter, Download, Edit2, Save, ShieldAlert, FileWarning } from 'lucide-react';
import { collection, query, where, getDocs, getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const db = getFirestore(getApp());

const LEAVE_TYPES_CONFIG = [
  { value: '特休', label: '特休' },
  { value: '事假', label: '事假' },
  { value: '病假', label: '病假' },
  { value: '喪假', label: '喪假' },
  { value: '公出', label: '公出' },
  { value: '補休', label: '補休' }
];

export default function AttendanceViewModal({ isOpen, onClose, selectedProject, personnel = [], allExistingUnits = [], initialMode = 'ALL_STATUS' }) {
  const [viewMonth, setViewMonth] = useState(new Date().toISOString().substring(0, 7));
  const [searchName, setSearchName] = useState('');
  const [selectedUnit, setSelectedUnit] = useState('ALL');
  
  // 🎯 一體化核心控制狀態
  const [viewMode, setViewMode] = useState('ALL_STATUS'); // 'ALL_STATUS' (全月總覽) | 'EXCEPTIONS_ONLY' (異常中心)
  const [exceptionSubFilter, setExceptionSubFilter] = useState('ALL_EXCEPTIONS'); // 'ALL_EXCEPTIONS' | 'ABSENT' | 'MISSING_CLOCK' | 'LATE_EARLY'

  const [records, setRecords] = useState([]);
  const [offDays, setOffDays] = useState({}); 
  const [isLoading, setIsLoading] = useState(false);
  const [isMonthEmpty, setIsMonthEmpty] = useState(false); // 全局月份未匯入偵測
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'asc' });

  const [editingRowId, setEditingRowId] = useState(null);
  const [editFormData, setEditFormData] = useState({ checkIn: '', checkOut: '', leaveRangeInfo: '', leaveType: '' });

  const cleanName = (str) => str ? str.toString().replace(/\s+/g, '').trim() : '';

  const timeToMinutes = (timeStr) => {
    if (!timeStr || !timeStr.includes(':')) return null;
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  };

  // 🎯 母元件控制通道聯動
  useEffect(() => {
    if (isOpen && initialMode) {
      setViewMode(initialMode);
      setExceptionSubFilter('ALL_EXCEPTIONS');
      setEditingRowId(null);
    }
  }, [isOpen, initialMode]);

  const fetchData = async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      // 1. 讀取工作日曆
      const calendarDocRef = doc(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'calendars', selectedProject);
      const calendarSnap = await getDoc(calendarDocRef);
      let currentOffDays = {};
      if (calendarSnap.exists()) {
        currentOffDays = calendarSnap.data().offDays || {};
        setOffDays(currentOffDays);
      }

      // 2. 讀取打卡流水號
      const attendanceRef = collection(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'attendance_records');
      const q = query(attendanceRef, where('projectId', '==', selectedProject), where('month', '==', viewMonth));
      
      const querySnapshot = await getDocs(q);
      const importedRecords = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // 🎯 全局月份匯入狀態防禦：只要當月有任何一筆打卡進來，就代表該月份已經開始匯入
      let globalMonthEmpty = importedRecords.length === 0;
      setIsMonthEmpty(globalMonthEmpty);

      const year = parseInt(viewMonth.split('-')[0], 10);
      const month = parseInt(viewMonth.split('-')[1], 10);
      const daysInMonth = new Date(year, month, 0).getDate();

      // 3. 過濾本月 active 人員
      const activePersonnel = personnel.filter(p => {
        if (p.hireDate && p.hireDate > `${year}-${String(month).padStart(2, '0')}-${daysInMonth}`) return false;
        if (p.contractEnd && p.contractEnd !== '至今' && p.contractEnd < `${year}-${String(month).padStart(2, '0')}-01`) return false;
        return true;
      });

      const personnelNames = activePersonnel.map(p => cleanName(p.name));
      const importedNames = importedRecords.map(r => cleanName(r.name)).filter(Boolean);
      const uniqueEmployeeNames = [...new Set([...personnelNames, ...importedNames])];

      const finalMeshRecords = [];

      if (uniqueEmployeeNames.length > 0) {
        uniqueEmployeeNames.forEach(empName => {
          const personInfo = personnel.find(p => cleanName(p.name) === cleanName(empName));

          for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isOffDay = !!currentOffDays[dateStr];

            // 🎯 歷史轉任歷程比對：若歷程未包含當前日期，代表當天不需要出勤，不報異常、直接跳過！
            let currentDayUnit = '已匯入人員';
            if (personInfo) {
              if (personInfo.history && Array.isArray(personInfo.history) && personInfo.history.length > 0) {
                const matchedHistory = personInfo.history.find(h => {
                  const startValid = !h.startDate || dateStr >= h.startDate;
                  const endValid = !h.endDate || dateStr <= h.endDate;
                  return startValid && endValid;
                });

                if (matchedHistory && matchedHistory.unit) {
                  currentDayUnit = matchedHistory.unit;
                } else {
                  continue; 
                }
              } else {
                continue; 
              }
            }

            const dayRecords = importedRecords.filter(r => cleanName(r.name) === cleanName(empName) && r.date === dateStr);
            let checkIn = ""; let checkOut = ""; let leaveRangeInfo = ""; let leaveType = "";
            let isManualMaintained = false;

            if (dayRecords.length > 0) {
              const validClockInRecord = dayRecords.find(r => r.checkIn && r.checkIn !== '');
              const validClockOutRecord = dayRecords.find(r => r.checkOut && r.checkOut !== '');
              const validLeaveRecord = dayRecords.find(r => r.leaveType && r.leaveType !== '');
              checkIn = validClockInRecord ? validClockInRecord.checkIn : (dayRecords[0].checkIn || "");
              checkOut = validClockOutRecord ? validClockOutRecord.checkOut : (dayRecords[0].checkOut || "");
              leaveRangeInfo = validLeaveRecord ? validLeaveRecord.leaveRangeInfo : (dayRecords[0].leaveRangeInfo || "");
              leaveType = validLeaveRecord ? validLeaveRecord.leaveType : (dayRecords[0].leaveType || "");
              isManualMaintained = !!dayRecords[0].isManualMaintained;
            }

            // 🎯 全局統一工時評判機制
            let statusType = 'NORMAL';
            if (isOffDay) {
              statusType = (checkIn || checkOut) ? 'OVERTIME' : 'OFFDAY';
            } else if (leaveType) {
              statusType = 'LEAVE';
            } else if (!checkIn && !checkOut) {
              statusType = globalMonthEmpty ? 'NORMAL' : 'ABSENT';
            } else if (!checkIn || !checkOut) {
              // 最初到職日首日特赦判定 (下班 >= 17:30 則放行免責)
              if (personInfo && personInfo.hireDate && dateStr === personInfo.hireDate && checkOut && timeToMinutes(checkOut) >= (17 * 60 + 30)) {
                statusType = 'NORMAL';
              } else {
                statusType = 'MISSING_CLOCK';
              }
            } else {
              const inMins = timeToMinutes(checkIn); const outMins = timeToMinutes(checkOut);
              if (inMins !== null && outMins !== null) {
                // 最初到職日當天雙打卡皆有但上班較晚的情況，只要 17:30 之後下班一律算正常
                if (personInfo && personInfo.hireDate && dateStr === personInfo.hireDate && outMins >= (17 * 60 + 30)) {
                  statusType = 'NORMAL';
                } else {
                  const maxStartMins = 9 * 60;      
                  let isLate = inMins > maxStartMins;
                  let legalMinOutMins = isLate ? 18 * 60 : Math.max(inMins, 8 * 60) + (9 * 60);
                  let isEarlyLeave = outMins < legalMinOutMins;
                  if (isLate || isEarlyLeave) {
                    statusType = 'LATE_EARLY';
                  }
                }
              }
            }

            finalMeshRecords.push({
              id: `mesh_${empName}_${dateStr}`,
              realDocId: (dayRecords.length > 0 && dayRecords[0].id) || `${selectedProject}_${empName}_${dateStr}`,
              projectId: selectedProject,
              month: viewMonth,
              name: personInfo ? personInfo.name : empName,
              unit: currentDayUnit, 
              date: dateStr,
              checkIn, checkOut, leaveRangeInfo, leaveType, isOffDay, isManualMaintained,
              statusType, 
              hireDate: personInfo ? personInfo.hireDate : null,
              isGeneratedMissing: dayRecords.length === 0
            });
          }
        });
      }
      setRecords(finalMeshRecords);
    } catch (error) {
      console.error("覆核大視窗交叉運算失敗:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, viewMonth, selectedProject, personnel]);

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown size={14} className="inline ml-1 text-slate-300 dark:text-slate-600" />;
    return sortConfig.direction === 'asc' ? <ArrowUp size={14} className="inline ml-1 text-indigo-500" /> : <ArrowDown size={14} className="inline ml-1 text-indigo-500" />;
  };

  const getStatusText = (r) => {
    if (r.statusType === 'OVERTIME') return "假日加班";
    if (r.statusType === 'OFFDAY') return "例假日/放假";
    if (r.statusType === 'LEAVE') return `已請假 (${r.leaveType})`;
    if (r.statusType === 'ABSENT') return "曠職 (應上班未打卡)";
    if (r.statusType === 'MISSING_CLOCK') return "異常: 缺打卡";
    
    if (r.statusType === 'LATE_EARLY') {
      const inMins = timeToMinutes(r.checkIn); const outMins = timeToMinutes(r.checkOut);
      const maxStartMins = 9 * 60;      
      let isLate = inMins > maxStartMins; let lateMinutes = isLate ? inMins - maxStartMins : 0;
      let legalMinOutMins = isLate ? 18 * 60 : Math.max(inMins, 8 * 60) + (9 * 60);
      let isEarlyLeave = outMins < legalMinOutMins; let earlyLeaveMinutes = isEarlyLeave ? legalMinOutMins - outMins : 0;
      if (isLate && isEarlyLeave) return `遲到 ${lateMinutes} 分 / 早退 ${earlyLeaveMinutes} 分`;
      if (isLate) return `遲到 ${lateMinutes} 分鐘`;
      if (isEarlyLeave) return `早退 ${earlyLeaveMinutes} 分鐘`;
    }
    return "正常出勤";
  };

  const renderStatusBadge = (r) => {
    const statusText = getStatusText(r);
    if (r.statusType === 'OVERTIME') return <span className="px-2.5 py-1 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 text-xs font-bold rounded-lg border border-amber-200 dark:border-amber-500/30">假日加班</span>;
    if (r.statusType === 'OFFDAY') return <span className="px-2.5 py-1 bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-400 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700">例假日/放假</span>;
    if (r.statusType === 'LEAVE') return <span className="px-2.5 py-1 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 text-xs font-bold rounded-lg border border-blue-200 dark:border-blue-500/30 flex items-center w-fit"><CheckCircle2 size={12} className="mr-1 text-blue-500" /> {statusText}</span>;
    if (r.statusType === 'ABSENT') return <span className="px-2.5 py-1 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 text-xs font-bold rounded-lg border border-red-200 dark:border-red-500/30 flex items-center w-fit animate-pulse"><AlertCircle size={12} className="mr-1 text-red-500" /> {statusText}</span>;
    if (r.statusType === 'MISSING_CLOCK' || r.statusType === 'LATE_EARLY') return <span className="px-2.5 py-1 bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 text-xs font-bold rounded-lg border border-orange-200 dark:border-orange-500/30">{statusText}</span>;
    return <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 text-xs font-bold rounded-lg border border-emerald-200 dark:border-emerald-500/30">正常出勤</span>;
  };

  // 🎯 前端多維複合過濾聯動
  const filteredRecords = records.filter(r => {
    const matchesName = r.name.toLowerCase().includes(searchName.trim().toLowerCase());
    const matchesUnit = selectedUnit === 'ALL' || r.unit === selectedUnit;
    
    if (viewMode === 'ALL_STATUS') {
      return matchesName && matchesUnit;
    }
    
    const isExceptionRow = r.statusType === 'ABSENT' || r.statusType === 'MISSING_CLOCK' || r.statusType === 'LATE_EARLY';
    if (!isExceptionRow) return false;
    
    if (exceptionSubFilter === 'ALL_EXCEPTIONS') return matchesName && matchesUnit;
    return matchesName && matchesUnit && r.statusType === exceptionSubFilter;
  });

  const sortedRecords = [...filteredRecords].sort((a, b) => {
    if (!sortConfig.key) return 0;
    let aValue = a[sortConfig.key] || ''; let bValue = b[sortConfig.key] || '';
    if (aValue === bValue) return sortConfig.key === 'date' ? a.name.localeCompare(b.name) : a.date.localeCompare(b.date);
    return sortConfig.direction === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
  });

  const handleExportCurrentViewExcel = () => {
    if (sortedRecords.length === 0) return alert('目前畫面上無過濾後的考勤資料可供匯出');
    const headers = ['打卡日期', '姓名', '計畫單位', '上班時間 (M)', '下班時間 (O)', '表定請假區間 (Z)', '假別', '日曆與工時交叉結果'];
    const csvRows = [headers.join(',')];
    sortedRecords.forEach(r => {
      csvRows.push([`"${r.date}"`, `"${r.name}"`, `"${r.unit}"`, `"${r.checkIn || '--'}"`, `"${r.checkOut || '--'}"`, `"${r.leaveRangeInfo || '--'}"`, `"${r.leaveType || '--'}"`, `"${getStatusText(r)}"`].join(','));
    });
    const blob = new Blob(["\uFEFF" + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `考勤日曆核對報表_${viewMonth}.csv`; link.click();
  };

  const startEditingRow = (r) => {
    setEditingRowId(r.id);
    setEditFormData({ checkIn: r.checkIn || '', checkOut: r.checkOut || '', leaveRangeInfo: r.leaveRangeInfo || '', leaveType: r.leaveType || '' });
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
        isManualMaintained: true, 
        updatedAt: new Date().getTime()
      };

      await setDoc(doc(attendanceRef, targetDocId), updatedData, { merge: true });
      setEditingRowId(null);
      fetchData(); 
    } catch (e) {
      console.error("手動維護考勤儲存失敗:", e);
      alert("儲存變更失敗。");
    }
  };

  const getUnitBadgeStyle = (unitName) => {
    const unitIndex = allExistingUnits.indexOf(unitName);
    const colorSpecs = [
      'bg-indigo-50 text-indigo-600 border-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20',  
      'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20', 
      'bg-purple-50 text-purple-600 border-purple-100 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20',
      'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20'
    ];
    if (unitIndex !== -1 && unitIndex < colorSpecs.length) return colorSpecs[unitIndex];
    return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white dark:bg-slate-800 w-full max-w-6xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-[88vh]">
        
        {/* Header Banner */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400"><Clock size={22} /></div>
            <div>
              <h3 className="font-bold text-lg text-slate-800 dark:text-white">計畫人員考勤數據管理與覆核中心</h3>
              <p className="text-xs text-slate-400 mt-0.5">本模組已完美整合 歷史轉任歷程軌跡、首日到職特赦令 與 異常集中維護清查大表。</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* View Mode Tabs一體化切換控制列 */}
        <div className="px-6 py-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-900/10 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200/50 dark:border-slate-700/50">
            <button 
              onClick={() => { setViewMode('ALL_STATUS'); setEditingRowId(null); }} 
              className={`flex items-center space-x-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'ALL_STATUS' ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
            >
              <FileText size={14} /><span>全月考勤總覽大表</span>
            </button>
            <button 
              onClick={() => { setViewMode('EXCEPTIONS_ONLY'); setEditingRowId(null); }} 
              className={`flex items-center space-x-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'EXCEPTIONS_ONLY' ? 'bg-red-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
            >
              <ShieldAlert size={14} /><span>考勤異常審查與維護中心</span>
            </button>
          </div>

          {/* 僅在異常模式下，動態顯示子分類按鈕 */}
          {viewMode === 'EXCEPTIONS_ONLY' && !isMonthEmpty && (
            <div className="flex flex-wrap items-center gap-1 animate-in slide-in-from-left-2 duration-200">
              <button onClick={() => setExceptionSubFilter('ALL_EXCEPTIONS')} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${exceptionSubFilter === 'ALL_EXCEPTIONS' ? 'bg-slate-900 border-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700'}`}>全部異常 ({filteredRecords.length})</button>
              <button onClick={() => setExceptionSubFilter('ABSENT')} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${exceptionSubFilter === 'ABSENT' ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700'}`}>曠職 ({records.filter(r=>r.statusType==='ABSENT').length})</button>
              <button onClick={() => setExceptionSubFilter('MISSING_CLOCK')} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${exceptionSubFilter === 'MISSING_CLOCK' ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700'}`}>缺打卡 ({records.filter(r=>r.statusType==='MISSING_CLOCK').length})</button>
              <button onClick={() => setExceptionSubFilter('LATE_EARLY')} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${exceptionSubFilter === 'LATE_EARLY' ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700'}`}>遲到/早退 ({records.filter(r=>r.statusType==='LATE_EARLY').length})</button>
            </div>
          )}
        </div>

        {/* Global Multi-Filter Action Bar */}
        <div className="p-4 bg-white dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-4 gap-3 items-center">
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
            <input type="text" placeholder="搜尋人員姓名快速過濾..." value={searchName} onChange={(e) => setSearchName(e.target.value)} className="pl-9 pr-4 py-2 w-full bg-white border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-white rounded-xl text-xs outline-none focus:border-indigo-500" />
          </div>
          
          <div className="flex items-center justify-end space-x-2">
            <button onClick={fetchData} disabled={isLoading} className="flex items-center space-x-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-600 rounded-xl text-xs font-bold transition-all"><RefreshCw size={12} className={isLoading ? "animate-spin text-indigo-500" : "text-indigo-500"} /><span>整理重新比對</span></button>
            <button onClick={handleExportCurrentViewExcel} disabled={isLoading || records.length === 0} className="flex items-center space-x-1.5 px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 shadow-xs transition-all" ><Download size={12} /><span>匯出明細 Excel</span></button>
          </div>
        </div>

        {/* Center Table Container */}
        <div className="overflow-y-auto flex-1 p-6 bg-slate-50/30 dark:bg-slate-900/10">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full space-y-2"><Loader2 size={36} className="text-indigo-500 animate-spin" /><span className="text-xs text-slate-400">正在追蹤全量歷史轉任軌跡（History）合規狀況...</span></div>
          ) : isMonthEmpty ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <FileWarning className="mx-auto text-amber-500 mb-2 animate-bounce" size={44} />
              <p className="text-sm font-extrabold text-amber-600 dark:text-amber-400">🚨 偵測提示：本月份之計畫出勤紀錄尚未匯入！</p>
              <p className="text-xs text-slate-400 mt-1.5">請先點擊下方按鈕關閉視窗，並透過「匯入出勤紀錄」功能上傳對應的 Excel 報表。</p>
            </div>
          ) : sortedRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12"><CheckCircle2 size={44} className="text-emerald-500 mb-3" /><p className="text-sm font-bold text-slate-700 dark:text-slate-300">{viewMode === 'ALL_STATUS' ? '目前查無符合條件之考勤紀錄' : '本月份目前查無任何考勤異常件，配置完全合規！'}</p></div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-x-auto shadow-sm bg-white dark:bg-slate-800 max-h-full">
              <table className="w-full text-left border-collapse relative">
                <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 shadow-xs">
                  <tr>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 select-none" style={{width: '90px'}} onClick={() => handleSort('date')}>打卡日期 <SortIcon columnKey="date" /></th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 select-none" style={{width: '160px'}} onClick={() => handleSort('name')}>姓名/計畫單位 <SortIcon columnKey="name" /></th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase" style={{width: '100px'}}>上班時間 (M)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase" style={{width: '100px'}}>下班時間 (O)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase" style={{width: '140px'}}>表定請假區間 (Z)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase" style={{width: '110px'}}>假別 (AB)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">日曆與工時交叉結果</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase text-right" style={{width: '130px'}}>核心維護權限</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 text-xs font-medium text-slate-700 dark:text-slate-300">
                  {sortedRecords.map((r) => {
                    const isRowEditing = editingRowId === r.id;
                    let rowBg = "bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700/30 transition-colors";
                    
                    if (isRowEditing) {
                      rowBg = "bg-indigo-50/40 dark:bg-indigo-950/20 text-slate-900 dark:text-white transition-all font-semibold";
                    } else if (r.statusType === 'ABSENT' || r.statusType === 'MISSING_CLOCK' || r.statusType === 'LATE_EARLY') {
                      rowBg = "bg-red-50/20 hover:bg-red-50/40 dark:bg-red-950/10 dark:hover:bg-red-950/20 text-red-950 dark:text-red-300";
                    } else if (r.isManualMaintained) {
                      rowBg = "bg-emerald-50/20 dark:bg-emerald-950/10 hover:bg-emerald-50/40";
                    } else if (r.statusType === 'OFFDAY') {
                      rowBg = "bg-slate-50/40 text-slate-400 dark:bg-slate-900/10";
                    }

                    return (
                      <tr key={r.id} className={rowBg}>
                        <td className="py-3.5 px-4 font-mono font-bold">{r.date.substring(5)}</td>
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-900 dark:text-slate-100">{r.name}</span>
                            <span className={`text-[10px] font-bold mt-0.5 tracking-wide px-1.5 py-0.5 rounded border w-fit shadow-2xs ${getUnitBadgeStyle(r.unit)}`}>{r.unit}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">{isRowEditing ? <input type="text" placeholder="ex. 08:30" value={editFormData.checkIn} onChange={e => setEditFormData({...editFormData, checkIn: e.target.value})} className="px-1.5 py-0.5 w-16 bg-white dark:bg-slate-900 border border-slate-200 rounded text-xs font-mono text-slate-800 dark:text-white" /> : <span className="font-mono">{r.checkIn || '--'}</span>}</td>
                        <td className="py-3.5 px-4">{isRowEditing ? <input type="text" placeholder="ex. 17:30" value={editFormData.checkOut} onChange={e => setEditFormData({...editFormData, checkOut: e.target.value})} className="px-1.5 py-0.5 w-16 bg-white dark:bg-slate-900 border border-slate-200 rounded text-xs font-mono text-slate-800 dark:text-white" /> : <span className="font-mono">{r.checkOut || '--'}</span>}</td>
                        <td className="py-3.5 px-4">{isRowEditing ? <input type="text" placeholder="ex. 16:38~17:38" value={editFormData.leaveRangeInfo} onChange={e => setEditFormData({...editFormData, leaveRangeInfo: e.target.value})} className="px-1.5 py-0.5 w-28 bg-white dark:bg-slate-900 border border-slate-200 rounded text-xs text-slate-800 dark:text-white" /> : <span className="text-slate-400 truncate block max-w-[130px]">{r.leaveRangeInfo || '--'}</span>}</td>
                        <td className="py-3.5 px-4">
                          {isRowEditing ? (
                            <select value={editFormData.leaveType} onChange={e => setEditFormData({...editFormData, leaveType: e.target.value})} className="border rounded p-0.5 bg-white dark:bg-slate-700 text-slate-800 dark:text-white font-bold">
                              <option value="" className="text-slate-800 bg-white dark:bg-slate-800 dark:text-slate-100">-- 無假別 --</option>
                              {LEAVE_TYPES_CONFIG.map(leave => <option key={leave.value} value={leave.value} className="text-slate-800 bg-white dark:bg-slate-800 dark:text-slate-100">{leave.label}</option>)}
                            </select>
                          ) : <span className="font-semibold text-slate-600 dark:text-slate-300">{r.leaveType || '--'}</span>}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center space-x-1.5">
                            {renderStatusBadge(r)}
                            
                            {/* 🔒 特赦令一鍵點擊解鎖安全閥按鈕 */}
                            {r.isManualMaintained && (
                              <button
                                type="button"
                                title="🔒 點擊此處可將特赦令解鎖釋出，還原重置覆蓋權限"
                                onClick={async () => {
                                  if (window.confirm(`確定要解鎖並釋出【${r.name}】在 ${r.date} 的防覆蓋鎖定狀態嗎？`)) {
                                    try {
                                      const attendanceRef = collection(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'attendance_records');
                                      await setDoc(doc(attendanceRef, r.realDocId), { isManualMaintained: false }, { merge: true });
                                      alert("🔓 成功解除特赦鎖定令！");
                                      fetchData(); 
                                    } catch (err) {
                                      alert("解鎖失敗。");
                                    }
                                  }
                                }}
                                className="px-1.5 py-0.5 bg-emerald-600 hover:bg-red-600 text-white rounded text-[9px] font-extrabold transition-colors group flex items-center shrink-0 cursor-pointer"
                              >
                                <span className="group-hover:hidden">🔒 已特赦鎖定</span>
                                <span className="hidden group-hover:inline">解鎖</span>
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {isRowEditing ? (
                            <div className="flex items-center justify-end space-x-1.5"><button type="button" onClick={() => setEditingRowId(null)} className="px-2 py-0.5 bg-slate-100 text-[11px] font-bold rounded">取消</button><button type="button" onClick={() => handleSaveRowChange(r)} className="px-2 py-0.5 bg-indigo-600 text-white text-[11px] font-bold rounded flex items-center shadow-xs"><Save size={12} className="mr-1" />儲存</button></div>
                          ) : <button type="button" onClick={() => startEditingRow(r)} className="text-indigo-600 hover:bg-indigo-50 px-2.5 py-1 rounded-xl dark:text-indigo-400 dark:hover:bg-indigo-500/10 text-[11px] font-bold flex items-center justify-end ml-auto"><Edit2 size={12} className="mr-1" />維護修訂</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex justify-end">
          <button onClick={onClose} className="px-6 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:text-white font-bold text-sm rounded-xl transition-all">關閉覆核中心</button>
        </div>
      </div>
    </div>
  );
}
