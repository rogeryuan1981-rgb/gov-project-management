import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Search, RefreshCw, AlertCircle, Clock, FileText, Loader2, CheckCircle2 } from 'lucide-react';
import { collection, query, where, getDocs, getFirestore, doc, getDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const db = getFirestore(getApp());

export default function AttendanceViewModal({ isOpen, onClose, selectedProject, personnel = [] }) {
  const [viewMonth, setViewMonth] = useState(new Date().toISOString().substring(0, 7));
  const [searchName, setSearchName] = useState('');
  const [records, setRecords] = useState([]);
  const [offDays, setOffDays] = useState({}); 
  const [isLoading, setIsLoading] = useState(false);

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

      // 步驟 B：讀取該月份已匯入的所有考勤紀錄 (包含所有 recordType 來源)
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

      // 若名冊全空，則降級相容使用已匯入資料內的人名
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

            // 【重大修正：跨表數據互補演算法】
            // 因為整月匯入時，某員工在當天可能在 A 表沒有打卡(留空)，但卻存在於 C 表的紀錄中。
            // 系統在此進行同一人、同一天的「全來源篩選」
            const sameDayRecords = importedRecords.filter(r => r.name === empName && r.date === dateStr);
            
            let mergedRecord = null;

            if (sameDayRecords.length > 0) {
              // 如果撈到不只一筆，優先抓取「有真實刷卡打卡時間」的紀錄，避免無打卡的舊紀錄覆蓋或造成誤判
              const validClockInRecord = sameDayRecords.find(r => r.checkIn && r.checkIn !== '');
              const validClockOutRecord = sameDayRecords.find(r => r.checkOut && r.checkOut !== '');
              const validLeaveRecord = sameDayRecords.find(r => r.leaveType && r.leaveType !== '');

              // 採用互補原則：將各表的有效欄位抽出來融合成一筆標準資料
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
              // 狀況 1：當天存在有效考勤或互補資料
              finalMeshRecords.push(mergedRecord);
            } else {
              // 狀況 2：兩邊考勤表皆完全查無此人在此日期的任何紀錄，系統自動補底判定
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
      
      // 依日期小到大 -> 姓名排序
      finalMeshRecords.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.name.localeCompare(b.name);
      });
      
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

  const filteredRecords = records.filter(r => 
    r.name.toLowerCase().includes(searchName.trim().toLowerCase())
  );

  // 交叉判定 Badges 視覺化輸出
  const renderStatusBadge = (r) => {
    if (r.isOffDay) {
      if (r.checkIn || r.checkOut) {
        return (
          <span className="px-2.5 py-1 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 text-xs font-bold rounded-lg border border-amber-200 dark:border-amber-500/30">
            假日加班
          </span>
        );
      }
      return (
        <span className="px-2.5 py-1 bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-600">
          例假日/放假
        </span>
      );
    }

    if (r.leaveType) {
      return (
        <span className="px-2.5 py-1 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 text-xs font-bold rounded-lg border border-blue-200 dark:border-blue-500/30 flex items-center w-fit">
          <CheckCircle2 size={12} className="mr-1 text-blue-500" /> 已請假 ({r.leaveType})
        </span>
      );
    }

    if (!r.checkIn && !r.checkOut) {
      return (
        <span className="px-2.5 py-1 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 text-xs font-bold rounded-lg border border-red-200 dark:border-red-500/30 flex items-center w-fit animate-pulse">
          <AlertCircle size={12} className="mr-1 text-red-500" /> 曠職 (應上班未打卡)
        </span>
      );
    }

    if (!r.checkIn || !r.checkOut) {
      return (
        <span className="px-2.5 py-1 bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 text-xs font-bold rounded-lg border border-orange-200 dark:border-orange-500/30">
          異常: 缺打卡
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
      <div className="bg-white dark:bg-slate-800 w-full max-w-5xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-[85vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
          <div className="flex items-center space-x-2">
            <Clock size={22} className="text-indigo-500" />
            <div>
              <h3 className="font-bold text-lg text-slate-800 dark:text-white">計畫人員月考勤與日曆覆核</h3>
              <p className="text-xs text-slate-400 mt-0.5">系統已自動啟用跨表互補機制，當日無 A 表數據時將自動追蹤並對消其餘考勤來源。</p>
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
              <span className="text-xs text-slate-400">正在執行跨表整合交集演算，排查全月出勤異常狀態...</span>
            </div>
          ) : filteredRecords.length === 0 ? (
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
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">打卡日期</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">姓名</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">上班時間 (M)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">下班時間 (O)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">表定請假區間 (Z)</th>
                    <th className="py-3 px-4 text-xs font-bold text-slate-500 uppercase">日曆與跨表交叉結果</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 text-xs font-medium text-slate-700 dark:text-slate-300">
                  {filteredRecords.map((r) => {
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
