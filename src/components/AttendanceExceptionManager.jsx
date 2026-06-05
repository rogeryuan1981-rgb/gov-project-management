import React, { useState, useEffect } from 'react';
import { ShieldAlert, Search, Filter, RefreshCw, Edit2, Save, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { collection, query, where, getDocs, getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
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

export default function AttendanceExceptionManager({ selectedProject, personnel = [] }) {
  const [targetMonth, setTargetMonth] = useState(new Date().toISOString().substring(0, 7));
  const [searchName, setSearchName] = useState('');
  const [exceptionFilter, setExceptionFilter] = useState('ALL_EXCEPTIONS'); // 'ALL_EXCEPTIONS' | 'ABSENT' | 'MISSING_CLOCK' | 'LATE_EARLY'
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ checkIn: '', checkOut: '', leaveRangeInfo: '', leaveType: '' });

  const cleanName = (str) => str ? str.toString().replace(/\s+/g, '').trim() : '';
  const timeToMinutes = (timeStr) => {
    if (!timeStr || !timeStr.includes(':')) return null;
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  };

  const fetchExceptions = async () => {
    if (!selectedProject) return;
    setIsLoading(true);
    try {
      // A. 讀取工作日曆設定
      const calendarDocRef = doc(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'calendars', selectedProject);
      const calendarSnap = await getDoc(calendarDocRef);
      const currentOffDays = calendarSnap.exists() ? (calendarSnap.data().offDays || {}) : {};

      // B. 讀取打卡流水號 (精準隨 targetMonth 動態向 Firebase 重新索取特定月份資料)
      const attendanceRef = collection(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'attendance_records');
      const q = query(attendanceRef, where('projectId', '==', selectedProject), where('month', '==', targetMonth));
      const querySnapshot = await getDocs(q);
      const importedRecords = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const year = parseInt(targetMonth.split('-')[0], 10);
      const month = parseInt(targetMonth.split('-')[1], 10);
      const daysInMonth = new Date(year, month, 0).getDate();

      // C. 人名雙向聯集組裝
      const activePersonnel = personnel.filter(p => {
        if (p.hireDate && p.hireDate > `${year}-${String(month).padStart(2, '0')}-${daysInMonth}`) return false;
        if (p.contractEnd && p.contractEnd < `${year}-${String(month).padStart(2, '0')}-01`) return false;
        return true;
      });
      const personnelNames = activePersonnel.map(p => cleanName(p.name));
      const importedNames = importedRecords.map(r => cleanName(r.name)).filter(Boolean);
      const uniqueNames = [...new Set([...personnelNames, ...importedNames])];

      const exceptionMesh = [];

      uniqueNames.forEach(empName => {
        const personInfo = personnel.find(p => cleanName(p.name) === cleanName(empName));

        for (let d = 1; d <= daysInMonth; d++) {
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          if (currentOffDays[dateStr]) continue; // 放假日排除，只抓應上班日

          const dayRecords = importedRecords.filter(r => cleanName(r.name) === cleanName(empName) && r.date === dateStr);
          let checkIn = ""; let checkOut = ""; let leaveRangeInfo = ""; let leaveType = "";
          let isManualMaintained = false;

          if (dayRecords.length > 0) {
            checkIn = dayRecords.find(r => r.checkIn)? dayRecords.find(r => r.checkIn).checkIn : (dayRecords[0].checkIn || "");
            checkOut = dayRecords.find(r => r.checkOut)? dayRecords.find(r => r.checkOut).checkOut : (dayRecords[0].checkOut || "");
            leaveRangeInfo = dayRecords.find(r => r.leaveType)? dayRecords[0].leaveRangeInfo : "";
            leaveType = dayRecords.find(r => r.leaveType)? dayRecords[0].leaveType : "";
            isManualMaintained = !!dayRecords[0].isManualMaintained;
          }

          // 判斷異常狀態類別
          let statusType = 'NORMAL';
          let statusText = '正常出勤';

          if (leaveType) {
            statusType = 'LEAVE'; statusText = `已請假 (${leaveType})`;
          } else if (!checkIn && !checkOut) {
            statusType = 'ABSENT'; statusText = '曠職 (應上班未打卡)';
          } else if (!checkIn || !checkOut) {
            statusType = 'MISSING_CLOCK'; statusText = '異常: 缺打卡';
          } else {
            const inMins = timeToMinutes(checkIn); const outMins = timeToMinutes(checkOut);
            if (inMins !== null && outMins !== null) {
              const maxStart = 9 * 60;
              let isLate = inMins > maxStart;
              let legalOut = isLate ? 18 * 60 : Math.max(inMins, 8 * 60) + (9 * 60);
              let isEarly = outMins < legalOut;
              if (isLate || isEarly) {
                statusType = 'LATE_EARLY';
                statusText = isLate && isEarly ? '遲到 ＋ 早退' : (isLate ? '遲到' : '早退');
              }
            }
          }

          // 僅收錄異常件 (過濾掉正常上班與常態請假)
          if (statusType === 'ABSENT' || statusType === 'MISSING_CLOCK' || statusType === 'LATE_EARLY') {
            exceptionMesh.push({
              id: `exc_${empName}_${dateStr}`,
              realDocId: (dayRecords.length > 0 && dayRecords[0].id) || `${selectedProject}_${empName}_${dateStr}`,
              name: personInfo ? personInfo.name : empName,
              unit: personInfo ? (personInfo.unit || '未指定單位') : '已匯入人員',
              date: dateStr,
              checkIn, checkOut, leaveRangeInfo, leaveType, statusType, statusText, isManualMaintained
            });
          }
        }
      });

      setRecords(exceptionMesh);
    } catch (error) {
      console.error("讀取異常報表失敗:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchExceptions();
  }, [targetMonth, selectedProject, personnel]);

  // 前端條件過濾
  const filteredRecords = records.filter(r => {
    const matchesName = r.name.toLowerCase().includes(searchName.trim().toLowerCase());
    if (exceptionFilter === 'ALL_EXCEPTIONS') return matchesName;
    return matchesName && r.statusType === exceptionFilter;
  });

  const startEdit = (r) => {
    setEditingId(r.id);
    setEditForm({ checkIn: r.checkIn, checkOut: r.checkOut, leaveRangeInfo: r.leaveRangeInfo, leaveType: r.leaveType });
  };

  const handleSave = async (r) => {
    try {
      const attendanceRef = collection(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'attendance_records');
      const updatedData = {
        projectId: selectedProject,
        month: targetMonth,
        name: r.name,
        date: r.date,
        checkIn: editForm.checkIn,
        checkOut: editForm.checkOut,
        leaveRangeInfo: editForm.leaveRangeInfo,
        leaveType: editForm.leaveType,
        recordType: 'MANUAL_MAINTAINED',
        isManualMaintained: true, // 手動修訂直接注入特赦令
        updatedAt: new Date().getTime()
      };

      await setDoc(doc(attendanceRef, r.realDocId), updatedData, { merge: true });
      setEditingId(null);
      fetchExceptions(); 
    } catch (e) {
      alert("儲存維護失敗");
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col min-h-[60vh] animate-in fade-in duration-300">
      {/* Top Banner */}
      <div className="p-6 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start space-x-3">
          <div className="p-3 bg-red-50 dark:bg-red-500/10 rounded-2xl text-red-600 dark:text-red-400 shrink-0"><ShieldAlert size={24} /></div>
          <div>
            <h3 className="font-bold text-lg text-slate-800 dark:text-white">計畫考勤異常審查與維護中心</h3>
            <p className="text-xs text-slate-400 mt-1">即時抽取工作日中所有「未打卡、缺打卡、遲到早退」之異常列。手動維護後會立即綁定特赦令，後續重新匯入時絕不被覆蓋。</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input type="month" value={targetMonth} onChange={e => setTargetMonth(e.target.value)} className="p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-white outline-none dark:[&::-webkit-calendar-picker-indicator]:invert" />
          <button onClick={fetchExceptions} className="p-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl hover:shadow-xs transition-all"><RefreshCw size={14} className={isLoading ? "animate-spin" : ""} /></button>
        </div>
      </div>

      {/* Filter Options */}
      <div className="px-6 py-4 bg-slate-50/30 dark:bg-slate-900/10 border-b border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          <button onClick={() => setExceptionFilter('ALL_EXCEPTIONS')} className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${exceptionFilter === 'ALL_EXCEPTIONS' ? 'bg-slate-900 border-slate-900 text-white dark:bg-white dark:border-white dark:text-slate-900' : 'bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'}`}>全部異常 ({records.length})</button>
          <button onClick={() => setExceptionFilter('ABSENT')} className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${exceptionFilter === 'ABSENT' ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'}`}>曠職 ({records.filter(r=>r.statusType==='ABSENT').length})</button>
          <button onClick={() => setExceptionFilter('MISSING_CLOCK')} className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${exceptionFilter === 'MISSING_CLOCK' ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'}`}>缺打卡 ({records.filter(r=>r.statusType==='MISSING_CLOCK').length})</button>
          <button onClick={() => setExceptionFilter('LATE_EARLY')} className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${exceptionFilter === 'LATE_EARLY' ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'}`}>遲到/早退 ({records.filter(r=>r.statusType==='LATE_EARLY').length})</button>
        </div>
        
        <div className="relative w-full sm:w-64">
          <Search size={13} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="輸入姓名快速檢索異常..." value={searchName} onChange={e => setSearchName(e.target.value)} className="w-full pl-8 pr-4 py-1.5 bg-white border border-slate-200 dark:bg-slate-900 dark:border-slate-700 dark:text-white rounded-xl text-xs outline-none focus:border-indigo-500" />
        </div>
      </div>

      {/* Table Body Container */}
      <div className="p-6 overflow-y-auto flex-1 max-h-[50vh]">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 space-y-2"><Loader2 size={32} className="animate-spin text-indigo-500" /><span className="text-xs text-slate-400">正在橫向調閱名冊，清洗抽取全月異常件...</span></div>
        ) : filteredRecords.length === 0 ? (
          <div className="text-center py-16"><CheckCircle className="mx-auto text-emerald-500 mb-2" size={40} /><p className="text-sm font-bold text-slate-700 dark:text-slate-300">本月份目前查無 考勤異常件，配置完全合規！</p></div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-2xs">
            <table className="w-full text-left border-collapse text-xs font-medium">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-3 px-4 text-slate-500 dark:text-slate-400" style={{width:'90px'}}>異常日期</th>
                  <th className="py-3 px-4 text-slate-500 dark:text-slate-400" style={{width:'150px'}}>姓名/組別</th>
                  <th className="py-3 px-4 text-slate-500 dark:text-slate-400" style={{width:'100px'}}>上班卡 (M)</th>
                  <th className="py-3 px-4 text-slate-500 dark:text-slate-400" style={{width:'100px'}}>下班卡 (O)</th>
                  <th className="py-3 px-4 text-slate-500 dark:text-slate-400" style={{width:'130px'}}>請假區間 (Z)</th>
                  <th className="py-3 px-4 text-slate-500 dark:text-slate-400" style={{width:'110px'}}>指定假別</th>
                  <th className="py-3 px-4 text-slate-500 dark:text-slate-400">當前異常分類</th>
                  <th className="py-3 px-4 text-slate-500 dark:text-slate-400 text-right" style={{width:'130px'}}>操作核心</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 text-slate-700 dark:text-slate-300">
                {filteredRecords.map(r => {
                  const isEditing = editingId === r.id;
                  let rowBg = "bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700/40";
                  if (isEditing) rowBg = "bg-indigo-50/50 dark:bg-indigo-950/20 font-semibold text-slate-950 dark:text-white";
                  else if (r.isManualMaintained) rowBg = "bg-emerald-50/20 dark:bg-emerald-950/10 hover:bg-emerald-50/40";

                  return (
                    <tr key={r.id} className={rowBg}>
                      <td className="py-3 px-4 font-bold font-mono">{r.date.substring(5)}</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-900 dark:text-slate-100">{r.name}</span>
                          <span className="text-[10px] text-slate-400 font-semibold">{r.unit}</span>
                        </div>
                      </td>
                      
                      <td className="py-3 px-4">{isEditing ? <input type="text" placeholder="08:30" value={editForm.checkIn} onChange={e=>setEditForm({...editForm, checkIn:e.target.value})} className="border rounded px-1.5 py-0.5 w-16 bg-white dark:bg-slate-900 font-mono text-slate-800 dark:text-white" /> : <span className="font-mono">{r.checkIn || '--'}</span>}</td>
                      <td className="py-3 px-4">{isEditing ? <input type="text" placeholder="17:30" value={editForm.checkOut} onChange={e=>setEditForm({...editForm, checkOut:e.target.value})} className="border rounded px-1.5 py-0.5 w-16 bg-white dark:bg-slate-900 font-mono text-slate-800 dark:text-white" /> : <span className="font-mono">{r.checkOut || '--'}</span>}</td>
                      <td className="py-3 px-4">{isEditing ? <input type="text" placeholder="13:00~17:30" value={editForm.leaveRangeInfo} onChange={e=>setEditForm({...editForm, leaveRangeInfo:e.target.value})} className="border rounded px-1.5 py-0.5 w-28 bg-white dark:bg-slate-900 text-slate-800 dark:text-white" /> : <span className="text-slate-400 max-w-[120px] truncate block">{r.leaveRangeInfo || '--'}</span>}</td>
                      
                      <td className="py-3 px-4">
                        {isEditing ? (
                          <select value={editForm.leaveType} onChange={e=>setEditForm({...editForm, leaveType:e.target.value})} className="border rounded p-0.5 bg-white dark:bg-slate-700 text-slate-800 dark:text-white font-bold">
                            <option value="" className="text-slate-800 bg-white dark:bg-slate-800 dark:text-slate-100">-- 無 --</option>
                            {LEAVE_TYPES_CONFIG.map(l => <option key={l.value} value={l.value} className="text-slate-800 bg-white dark:bg-slate-800 dark:text-slate-100">{l.label}</option>)}
                          </select>
                        ) : <span className="font-bold text-slate-500">{r.leaveType || '--'}</span>}
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-1.5">
                          <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] border ${
                            r.statusType === 'ABSENT' ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20' : 
                            (r.statusType === 'MISSING_CLOCK' ? 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20' : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20')
                          }`}>{r.statusText}</span>
                          
                          {/* 💡 方案 B：升級鎖定標籤為「高度互動型一鍵解鎖按鈕」 */}
                          {r.isManualMaintained && (
                            <button
                              type="button"
                              title="🔒 點擊此處可將特赦令解鎖釋出，重開覆蓋權限"
                              onClick={async () => {
                                if (window.confirm(`確定要解鎖並釋出【${r.name}】在 ${r.date} 的防覆蓋狀態嗎？\n解鎖後，下次重新匯入考勤 CSV 將會直接覆蓋本條數據。`)) {
                                  try {
                                    const attendanceRef = collection(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'attendance_records');
                                    // 將 isManualMaintained 實時設為 false 降級
                                    await setDoc(doc(attendanceRef, r.realDocId), { isManualMaintained: false }, { merge: true });
                                    alert("🔓 成功解除特赦鎖定令！下次匯入即可自動覆蓋。");
                                    fetchExceptions(); // 實時重算刷新
                                  } catch (err) {
                                    alert("解鎖失敗，請檢查權限。");
                                  }
                                }
                              }}
                              className="px-1.5 py-0.5 bg-emerald-600 hover:bg-red-600 text-white rounded text-[9px] font-extrabold shadow-3xs transition-colors group flex items-center space-x-0.5 cursor-pointer"
                            >
                              <span className="group-hover:hidden">🔒 已特赦鎖定</span>
                              <span className="hidden group-hover:inline">🔓 點擊解除鎖定</span>
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end space-x-1"><button onClick={()=>setEditingId(null)} className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded">取消</button><button onClick={()=>handleSave(r)} className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded flex items-center shadow-2xs"><Save size={11} className="mr-1" />儲存</button></div>
                        ) : <button onClick={()=>startEdit(r)} className="px-2 py-1 border border-slate-200 hover:border-indigo-400 text-indigo-600 dark:text-indigo-400 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-500/10 font-bold transition-all flex items-center justify-end ml-auto"><Edit2 size={11} className="mr-1" />補登修訂</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
