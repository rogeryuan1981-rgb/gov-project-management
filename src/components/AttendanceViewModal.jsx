import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Search, RefreshCw, AlertCircle, Clock, FileText, Loader2, CheckCircle2, ArrowUpDown, ArrowUp, ArrowDown, Filter, Download } from 'lucide-react';
import { collection, query, where, getDocs, getFirestore, doc, getDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const db = getFirestore(getApp());

export default function AttendanceViewModal({ isOpen, onClose, selectedProject, personnel = [] , allExistingUnits = [] }) {
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
      return <span className="px-2
