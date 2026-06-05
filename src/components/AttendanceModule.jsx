import React, { useState, useEffect } from 'react';
import { Clock, Upload, CalendarDays, ShieldAlert, AlertCircle, ChevronRight, CheckCircle2, Sliders, ToggleLeft, ToggleRight, Check, X, UserCheck, Save, Calendar, Trash2, Edit2 } from 'lucide-react';
import { collection, onSnapshot, doc, getFirestore, query, where, updateDoc, setDoc, getDoc } from 'firebase/firestore'; 
import { initializeApp, getApps, getApp } from 'firebase/app';

import AttendanceImportModal from './AttendanceImportModal';
import WorkCalendarSettingsModal from './WorkCalendarSettingsModal';
import AttendanceViewModal from './AttendanceViewModal';
import AttendanceExceptionManager from './AttendanceExceptionManager';

const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

export default function AttendanceModule({ user, selectedProject }) {
  const [personnel, setPersonnel] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [dbError, setDbError] = useState(null);

  const [attendanceSubTab, setAttendanceSubTab] = useState('exception');
  const [isAttendanceImportOpen, setIsAttendanceImportOpen] = useState(false);
  const [isCalendarSettingsOpen, setIsCalendarSettingsOpen] = useState(false);
  const [isAttendanceViewOpen, setIsAttendanceViewOpen] = useState(false);

  // 防呆設定面板開窗狀態
  const [isProxySettingsModalOpen, setIsProxySettingsModalOpen] = useState(false);
  
  // 點選「代理異常卡片」後彈出的明細與多重排代維護大視窗
  const [isProxyExceptionDetailsOpen, setIsProxyExceptionDetailsOpen] = useState(false);

  // 代理篩選規則狀態定義
  const [proxyThresholdDays, setProxyThresholdDays] = useState(2); 
  const [includeHolidays, setIncludeHolidays] = useState(false); 
  const [monthlyThresholdDays, setMonthlyThresholdDays] = useState(5); 
  const [exemptLeaveTypes, setExemptLeaveTypes] = useState(['特休', '補休']);
  const [exemptUnits, setExemptUnits] = useState([]);

  const ALL_LEAVE_TYPES = ['特休', '事假', '病假', '喪假', '公出', '補休'];

  // 控制特定派代明細列的手動新表單展開狀態
  const [assigningId, setAssigningId] = useState(null);
  const [assignForm, setAssignForm] = useState({ proxyName: '', startHour: '08:30', endHour: '17:30' });

  // 歷史代理時段就地編輯控制狀態
  const [editingSubRecordIdx, setEditingSubRecordIdx] = useState(null);
  const [subEditForm, setSubEditForm] = useState({ proxyName: '', startHour: '08:30', endHour: '17:30' });

  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [currentOffDays, setCurrentOffDays] = useState({});

  const today = new Date().toISOString().split('T')[0];
  const todayYearMonth = today.substring(0, 7);

  // 時間轉分鐘輔助函數
  const timeToMinutes = (timeStr) => {
    if (!timeStr || !timeStr.includes(':')) return 0;
    const parts = timeStr.split(':');
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  };

  useEffect(() => {
    if (!user || !selectedProject) return;
    setDbError(null);

    const projectRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'projects', selectedProject);
    const unsubProject = onSnapshot(projectRef, (docSnap) => {
      if (docSnap.exists()) setProjectName(docSnap.data().name);
    });

    const hrRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'personnel');
    const reqRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'manpower_reqs');
    
    const attRecordsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'attendance_records');
    const qAtt = query(attRecordsRef, where('projectId', '==', selectedProject), where('month', '==', todayYearMonth));
    
    const unsubAtt = onSnapshot(qAtt, (snapshot) => {
      const loadedAtt = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAttendanceRecords(loadedAtt);
    });

    const calendarDocRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'calendars', selectedProject);
    const unsubCalendar = onSnapshot(calendarDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setCurrentOffDays(docSnap.data().offDays || {});
      }
    });

    const unsubHR = onSnapshot(hrRef, (snapshot) => {
      const loadedData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPersonnel(loadedData.filter(p => p.projectId === selectedProject));
      setIsDataLoaded(true);
    }, (error) => { if (error.code === 'permission-denied') setDbError('【權限不足】讀取人員資料失敗'); });

    const unsubReq = onSnapshot(reqRef, (snapshot) => {
      setRequirements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(r => r.projectId === selectedProject));
    });

    return () => { unsubProject(); unsubHR(); unsubReq(); unsubAtt(); unsubCalendar(); };
  }, [user, selectedProject]);

  const allExistingUnits = [...new Set(personnel.map(p => p.unit).filter(Boolean))];

  // =========================================================================
  // 🧠 核心升級：具備部分時數扣減、多重排代時段覆蓋率精算之代理異常分析引擎
  // =========================================================================
  const getProxyAnalysisReport = () => {
    let exceptionHours = 0;
    const exceptionDetailsList = [];
    
    const year = parseInt(todayYearMonth.split('-')[0], 10);
    const month = parseInt(todayYearMonth.split('-')[1], 10);
    const daysInMonth = new Date(year, month, 0).getDate();

    personnel.forEach(person => {
      let monthlyLeaveCount = 0;
      let continuousLeaveChain = 0;

      const monthLeaveMap = {};
      const monthRecordMap = {}; 

      const rawHistoryList = person.assignmentHistory || person.history || [];
      const sortedHistory = [...rawHistoryList]
        .filter(h => h.unit && h.startDate)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayRecord = attendanceRecords.find(r => r.name === person.name && r.date === dateStr);
        
        if (dayRecord && dayRecord.leaveType) {
          monthLeaveMap[d] = dayRecord.leaveType;
          monthRecordMap[d] = dayRecord; 
        } else {
          monthLeaveMap[d] = null;
          monthRecordMap[d] = null;
        }
      }

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isOffDay = !!currentOffDays[dateStr];
        const leaveType = monthLeaveMap[d];
        const record = monthRecordMap[d];

        if (isOffDay) {
          if (includeHolidays) {
            // 假日不切斷連續請假鏈條
          } else {
            continuousLeaveChain = 0;
          }
          continue;
        }

        let currentDayUnit = person.unit || '未指定單位';
        if (sortedHistory.length > 0) {
          const matchedIdx = sortedHistory.findIndex(h => {
            const startValid = dateStr >= h.startDate;
            const endValid = !h.endDate || dateStr <= h.endDate;
            return startValid && endValid;
          });
          if (matchedIdx !== -1) {
            currentDayUnit = sortedHistory[matchedIdx].unit;
          }
        }

        if (leaveType) {
          monthlyLeaveCount++;
          continuousLeaveChain++;

          const needProxyByContinuous = continuousLeaveChain > proxyThresholdDays;
          const needProxyByMonthly = monthlyLeaveCount > monthlyThresholdDays;

          if (needProxyByContinuous || needProxyByMonthly) {
            const isExemptLeaveToday = exemptLeaveTypes.includes(leaveType);
            const isExemptUnitToday = exemptUnits.includes(currentDayUnit);

            if (!isExemptLeaveToday && !isExemptUnitToday) {
              // 💡 核心演算法升級：計算多重排代時段的覆蓋率
              // 一天標準應上班時數為 8 小時 (480分鐘)
              const requiredMinutes = 8 * 60;
              let totalCoveredMinutes = 0;

              // 相容單筆舊數據字串或新版多時段陣列結構 (proxySegments)
              const segments = record?.proxySegments || [];
              if (segments.length === 0 && record?.proxyName) {
                // 如果是舊格式單筆數據，自動推導轉換為一個標準區段進行精算
                const range = record.leaveRangeInfo || "08:30~17:30";
                if (range.includes('~')) {
                  const p = range.split('~');
                  const startM = timeToMinutes(p[0]);
                  const endM = timeToMinutes(p[1]);
                  if (endM > startM) totalCoveredMinutes += (endM - startM);
                } else {
                  totalCoveredMinutes += requiredMinutes; // 舊格式兜底視為全覆蓋
                }
              } else {
                // 逐筆累加多段代理的分鐘總量
                segments.forEach(seg => {
                  const sM = timeToMinutes(seg.startHour);
                  const eM = timeToMinutes(seg.endHour);
                  if (eM > sM) totalCoveredMinutes += (eM - sM);
                });
              }

              // 💡 計算尚缺少多少代理時數 (不能少於門檻)
              const uncoveredMinutes = Math.max(0, requiredMinutes - totalCoveredMinutes);
              const uncoveredHours = Math.ceil(uncoveredMinutes / 60);

              // 只要尚有未被代理滿 8 小時的部分，即算入異常案件明細中！
              if (uncoveredHours > 0) {
                exceptionHours += uncoveredHours;
                
                const realDocId = record?.id || `${selectedProject}_${person.name}_${dateStr}`;
                
                exceptionDetailsList.push({
                  uniqueId: `proxy_exc_${person.name}_${dateStr}`,
                  realDocId: realDocId,
                  name: person.name,
                  unit: currentDayUnit,
                  date: dateStr,
                  leaveType: leaveType,
                  leaveRangeInfo: record?.leaveRangeInfo || '全天差假',
                  uncoveredHours: uncoveredHours, // 帶出殘留異常小時數
                  proxySegments: segments, // 傳遞目前已建立的子代理歷程清單
                  triggerReason: `代理時數不足！當天應代理 8 小時，目前已排代 ${Math.round(totalCoveredMinutes/60*10)/10} 小時，尚缺 ${uncoveredHours} 小時。`
                });
              }
            }
          }
        } else {
          continuousLeaveChain = 0;
        }
      }
    });

    return { exceptionHours, exceptionDetailsList };
  };

  const { exceptionHours: totalProxyExceptionHours, exceptionDetailsList: proxyExceptionList } = getProxyAnalysisReport();

  const handleToggleExemptLeave = (type) => {
    if (exemptLeaveTypes.includes(type)) {
      setExemptLeaveTypes(exemptLeaveTypes.filter(t => t !== type));
    } else {
      setExemptLeaveTypes([...exemptLeaveTypes, type]);
    }
  };

  const handleToggleExemptUnit = (unitName) => {
    if (exemptUnits.includes(unitName)) {
      setExemptUnits(exemptUnits.filter(u => u !== unitName));
    } else {
      setExemptUnits([...exemptUnits, unitName]);
    }
  };

  // =========================================================================
  // 💥 多重分段代理人：新增代理人時段段落引擎 (不覆蓋舊時段，以多橫列陣列儲存)
  // =========================================================================
  const handleSaveProxyAssignment = async (item) => {
    if (!assignForm.proxyName.trim()) { alert("請填寫代理人姓名！"); return; }
    
    const startM = timeToMinutes(assignForm.startHour);
    const endM = timeToMinutes(assignForm.endHour);
    if (endM <= startM) { alert("錯誤：代理結束時間必須晚於起始時間！"); return; }

    try {
      const attRecordsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'attendance_records');
      const docRef = doc(attRecordsRef, item.realDocId);
      
      const docSnap = await getDoc(docRef);
      const baseData = docSnap.exists() ? docSnap.data() : {};

      // 提取舊有的多段歷程
      const currentSegments = baseData.proxySegments || [];
      const newSegment = {
        proxyName: assignForm.proxyName.trim(),
        startHour: assignForm.startHour,
        endHour: assignForm.endHour,
        createdAt: new Date().getTime()
      };

      const updatedSegments = [...currentSegments, newSegment];

      const updatedProxyData = {
        ...baseData,
        projectId: selectedProject,
        month: todayYearMonth,
        name: item.name,
        date: item.date,
        leaveType: item.leaveType,
        proxySegments: updatedSegments, 
        proxyName: updatedSegments.map(s => s.proxyName).join(', '), // 同步拼串人名欄位相容舊報表表格
        isManualMaintained: true, 
        updatedAt: new Date().getTime()
      };

      await setDoc(docRef, updatedProxyData, { merge: true });
      setAssignForm({ proxyName: '', startHour: '08:30', endHour: '17:30' });
      alert(`✅ 成功為 ${item.name} 新增一段代理時段：${newSegment.startHour}~${newSegment.endHour}！`);
    } catch (e) {
      console.error(e);
      alert("指派代理時段失敗");
    }
  };

  // =========================================================================
  // 💥 已有代理歷程：就地更新/編輯子代理段落
  // =========================================================================
  const handleUpdateSubSegment = async (item, subIdx) => {
    if (!subEditForm.proxyName.trim()) { alert("代理人名不可為空！"); return; }
    const startM = timeToMinutes(subEditForm.startHour);
    const endM = timeToMinutes(subEditForm.endHour);
    if (endM <= startM) { alert("結束時間錯誤！"); return; }

    try {
      const attRecordsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'attendance_records');
      const docRef = doc(attRecordsRef, item.realDocId);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) return;

      const baseData = docSnap.data();
      const segments = [...(baseData.proxySegments || [])];
      
      segments[subIdx] = {
        proxyName: subEditForm.proxyName.trim(),
        startHour: subEditForm.startHour,
        endHour: subEditForm.endHour,
        updatedAt: new Date().getTime()
      };

      await updateDoc(docRef, {
        proxySegments: segments,
        proxyName: segments.map(s => s.proxyName).join(', '),
        updatedAt: new Date().getTime()
      });

      setEditingSubRecordIdx(null);
      alert("✅ 代理時段修改維護成功！");
    } catch (e) { console.error(e); }
  };

  // =========================================================================
  // 💥 已有代理歷程：就地刪除特定子代理段落 (釋出時數)
  // =========================================================================
  const handleDeleteSubSegment = async (item, subIdx) => {
    if (!confirm("確定要刪除這段代理時間歷程嗎？刪除後對應的代理時數將會被釋出重新判定為異常。")) return;
    try {
      const attRecordsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'attendance_records');
      const docRef = doc(attRecordsRef, item.realDocId);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) return;

      const baseData = docSnap.data();
      const segments = (baseData.proxySegments || []).filter((_, i) => i !== subIdx);

      await updateDoc(docRef, {
        proxySegments: segments,
        proxyName: segments.map(s => s.proxyName).join(', '),
        updatedAt: new Date().getTime()
      });
      alert("🗑️ 代理時段移除成功，時數已釋出。");
    } catch (e) { console.error(e); }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-6xl mx-auto">
      {dbError && <div className="bg-red-50 p-4 rounded-2xl border border-red-200 text-red-700 text-sm">{dbError}</div>}

      <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center">
            <Clock className="mr-3 text-indigo-500" size={24} /> 計畫考勤管理中心 ({projectName || '載入中...'})
          </h2>
          <p className="text-sm text-slate-500 mt-1">獨立控管打卡流水號，審查異常並提供防覆蓋保護令維護。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div 
          onClick={() => totalProxyExceptionHours > 0 && setIsProxyExceptionDetailsOpen(true)}
          className={`bg-white dark:bg-slate-800 p-6 rounded-2xl border shadow-sm flex items-center justify-between transition-all ${
            totalProxyExceptionHours > 0 
              ? 'border-orange-200 dark:border-orange-500/30 cursor-pointer hover:border-orange-400 dark:hover:border-orange-500/50 group' 
              : 'border-slate-200 dark:border-slate-700/50'
          }`}
        >
          <div className="flex items-center space-x-5">
            <div className={`p-3.5 rounded-xl transition-transform ${totalProxyExceptionHours > 0 ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 group-hover:scale-110' : 'bg-slate-50 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500'}`}>
              <AlertCircle size={28} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-1">代理異常</p>
              <p className={`text-3xl font-black ${totalProxyExceptionHours > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-800 dark:text-white'}`}>
                {totalProxyExceptionHours} <span className="text-sm font-medium text-slate-500">小時</span>
              </p>
            </div>
          </div>
          {totalProxyExceptionHours > 0 && (
            <div className="text-orange-500 dark:text-orange-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1">
              <span className="text-xs font-bold">點擊補登代理時段</span>
              <ChevronRight size={14} />
            </div>
          )}
        </div>
        
        <div 
          onClick={() => setIsCalendarSettingsOpen(true)}
          className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex items-center justify-between cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500/50 transition-colors group"
        >
          <div className="flex items-center space-x-5">
            <div className="p-3.5 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
              <CalendarDays size={24} />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">工作日曆與法定假別設定</p>
              <p className="text-sm font-black text-slate-800 dark:text-white">點擊設定應上班日曆與假期</p>
            </div>
          </div>
          <div className="text-indigo-500 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
            <ChevronRight size={16} />
          </div>
        </div>

        <div 
          onClick={() => setIsProxySettingsModalOpen(true)}
          className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex items-center justify-between cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500/50 transition-colors group"
        >
          <div className="flex items-center space-x-5">
            <div className="p-3.5 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
              <Sliders size={24} />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">規政代理與合規防呆設定</p>
              <p className="text-sm font-black text-slate-800 dark:text-white">點擊設定連續與累計請假天數</p>
            </div>
          </div>
          <div className="text-indigo-500 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
            <ChevronRight size={16} />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-slate-800 dark:text-white mb-1">匯入最新打卡 CSV</h3>
          <p className="text-sm text-slate-500">支援 A/C 表格式，系統會自動比對並鎖定人工補登資料。</p>
        </div>
        <div className="flex items-center space-x-3 shrink-0">
          <button onClick={() => setIsAttendanceImportOpen(true)} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all">匯入考勤 CSV</button>
        </div>
      </div>

      <div className="flex border-b border-slate-200 dark:border-slate-700 space-x-1 p-1 rounded-xl w-fit bg-slate-100/60 dark:bg-slate-900/40">
        <button onClick={() => setAttendanceSubTab('exception')} className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center ${attendanceSubTab === 'exception' ? 'bg-white dark:bg-slate-800 text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><ShieldAlert size={14} className="inline mr-1" />⚠️ 異常維護面板</button>
        <button onClick={() => setAttendanceSubTab('full_calendar')} className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center ${attendanceSubTab === 'full_calendar' ? 'bg-white dark:bg-slate-800 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><CalendarDays size={14} className="inline mr-1" />📅 全月日曆總覽</button>
      </div>

      <div className="attendance-sub-tab-content">
        {attendanceSubTab === 'exception' ? (
          <AttendanceExceptionManager selectedProject={selectedProject} personnel={personnel} />
        ) : (
          <div className="bg-white dark:bg-slate-800 p-8 text-center rounded-2xl border dark:border-slate-700">
             <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">您可以一鍵展開包含特赦鎖定狀態的 1~31 天跨表差假對齊大矩陣：</p>
             <button onClick={() => setIsAttendanceViewOpen(true)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl transition-all">🔍 開啟全月覆核大彈窗</button>
          </div>
        )}
      </div>

      {/* =========================================================================
          💡 升級：全新優化支援「部分時數扣減」與「已有歷史時段二級編輯面板」的派代大彈窗
         ========================================================================= */}
      {isProxyExceptionDetailsOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 w-full max-w-5xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
              <div>
                <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center"><ShieldAlert size={20} className="mr-2 text-orange-500" />特定假別代理異常案件審查中心</h3>
                <p className="text-xs text-slate-400 mt-0.5">系統已啟動多重時段覆蓋率交叉精算，必須累積代理滿 8 小時（480分鐘）該日異常方可完全滑出本清單。</p>
              </div>
              <button onClick={() => { setIsProxyExceptionDetailsOpen(false); setAssigningId(null); setEditingSubRecordIdx(null); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors"><X size={20} /></button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-900/20">
              <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm bg-white dark:bg-slate-800">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-500">
                    <tr>
                      <th className="py-3 px-4" style={{width: '95px'}}>請假日期</th>
                      <th className="py-3 px-4" style={{width: '120px'}}>姓名/組別</th>
                      <th className="py-3 px-4" style={{width: '85px'}}>假別屬性</th>
                      <th className="py-3 px-4">系統超標及覆蓋率追蹤判定原因</th>
                      <th className="py-3 px-4 text-right" style={{width: '210px'}}>核心手動分段派代作業</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 text-slate-700 dark:text-slate-200 font-medium">
                    {proxyExceptionList.map(item => {
                      const isAssigning = assigningId === item.uniqueId;
                      // 讀取這一天該案件目前已經登錄的所有子歷程
                      const currentSubSegments = item.proxySegments || [];
                      
                      return (
                        <React.Fragment key={item.uniqueId}>
                          <tr className={`hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors ${isAssigning ? 'bg-indigo-50/40 dark:bg-indigo-950/20' : ''}`}>
                            <td className="py-3 px-4 font-bold font-mono text-slate-900 dark:text-slate-100">{item.date}</td>
                            <td className="py-3 px-4">
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-900 dark:text-slate-100">{item.name}</span>
                                <span className="text-[10px] text-slate-400 font-semibold">{item.unit}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4"><span className="px-2 py-0.5 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 rounded-md font-bold border border-red-100 dark:border-red-500/20">{item.leaveType}</span></td>
                            <td className="py-3 px-4">
                              <div className="text-slate-600 dark:text-slate-300 leading-relaxed font-semibold">{item.triggerReason}</div>
                              <div className="text-[10px] text-orange-600 font-bold mt-0.5">⚠️ 目前尚缺：{item.uncoveredHours} 小時尚未指派代理。</div>
                            </td>
                            <td className="py-3 px-4 text-right">
                              {isAssigning ? (
                                <div className="space-y-2 p-3 bg-white dark:bg-slate-900 border border-indigo-200 rounded-xl shadow-md text-left animate-in slide-in-from-top-2 duration-250 w-[240px] ml-auto">
                                  <div className="font-bold text-[11px] text-indigo-700 border-b pb-1 mb-1">➕ 新增本段代理時段</div>
                                  <div>
                                    <label className="block text-[9px] font-bold text-slate-400 mb-0.5">代理人姓名 *</label>
                                    <input type="text" value={assignForm.proxyName} onChange={e => setAssignForm({...assignForm, proxyName: e.target.value})} placeholder="請輸入同仁姓名" className="w-full px-2 py-1 bg-slate-50 dark:bg-slate-800 border rounded text-xs outline-none text-slate-800 dark:text-white font-bold" />
                                  </div>
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <div>
                                      <label className="block text-[9px] font-bold text-slate-400 mb-0.5">時間(起)</label>
                                      <input type="text" value={assignForm.startHour} onChange={e => setAssignForm({...assignForm, startHour: e.target.value})} placeholder="08:30" className="w-full px-1.5 py-0.5 bg-slate-50 dark:bg-slate-800 border rounded text-[11px] font-mono text-center" />
                                    </div>
                                    <div>
                                      <label className="block text-[9px] font-bold text-slate-400 mb-0.5">時間(迄)</label>
                                      <input type="text" value={assignForm.endHour} onChange={e => setAssignForm({...assignForm, endHour: e.target.value})} placeholder="12:30" className="w-full px-1.5 py-0.5 bg-slate-50 dark:bg-slate-800 border rounded text-[11px] font-mono text-center" />
                                    </div>
                                  </div>
                                  <div className="flex justify-end space-x-1.5 pt-1.5 border-t">
                                    <button type="button" onClick={() => setAssigningId(null)} className="px-2 py-0.5 bg-slate-100 text-slate-600 font-bold rounded text-[10px]">取消</button>
                                    <button type="button" onClick={() => handleSaveProxyAssignment(item)} className="px-2 py-0.5 bg-indigo-600 text-white font-bold rounded text-[10px] flex items-center shadow-xs">儲存此段</button>
                                  </div>
                                </div>
                              ) : (
                                <button type="button" onClick={() => { setAssigningId(item.uniqueId); setEditingSubRecordIdx(null); setAssignForm({ proxyName: '', startHour: '08:30', endHour: '17:30' }); }} className="px-2.5 py-1.5 border border-slate-200 hover:border-indigo-400 text-indigo-600 dark:text-indigo-400 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-500/10 font-bold transition-all inline-flex items-center"><UserCheck size={12} className="mr-1" />指派代理時段</button>
                              )}
                            </td>
                          </tr>

                          {/* 💡 核心加開：下方多橫列展示「之前已維護之子代理歷程」控制面板 */}
                          {currentSubSegments.length > 0 && (
                            <tr>
                              <td colSpan="5" className="bg-slate-50/60 dark:bg-slate-900/30 px-6 py-2 border-b">
                                <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1.5 flex items-center">
                                  <Calendar size={11} className="mr-1 text-emerald-500" /> 已登錄之代理人時段分配清單 ({currentSubSegments.length} 段)：
                                </div>
                                <div className="space-y-1.5">
                                  {currentSubSegments.map((subSeg, subIdx) => {
                                    const isSubEditing = editingSubRecordIdx === `${item.uniqueId}_${subIdx}`;
                                    return (
                                      <div key={subIdx} className="flex flex-col sm:flex-row sm:items-center justify-between bg-white dark:bg-slate-800 border p-2 rounded-xl text-xs max-w-2xl shadow-2xs group/sub">
                                        {isSubEditing ? (
                                          <div className="flex flex-wrap items-center gap-2 w-full animate-in fade-in duration-200">
                                            <input type="text" value={subEditForm.proxyName} onChange={e => setSubEditForm({...subEditForm, proxyName: e.target.value})} className="px-2 py-0.5 border rounded bg-slate-50 w-24 font-bold" placeholder="代理人" />
                                            <span className="text-[10px] text-slate-400">起</span>
                                            <input type="text" value={subEditForm.startHour} onChange={e => setSubEditForm({...subEditForm, startHour: e.target.value})} className="px-1.5 py-0.5 border rounded bg-slate-50 w-16 text-center font-mono" />
                                            <span className="text-[10px] text-slate-400">迄</span>
                                            <input type="text" value={subEditForm.endHour} onChange={e => setSubEditForm({...subEditForm, endHour: e.target.value})} className="px-1.5 py-0.5 border rounded bg-slate-50 w-16 text-center font-mono" />
                                            <div className="ml-auto flex space-x-1">
                                              <button type="button" onClick={() => setEditingSubRecordIdx(null)} className="px-2 py-0.5 bg-slate-100 rounded text-[10px]">取消</button>
                                              <button type="button" onClick={() => handleUpdateSubSegment(item, subIdx)} className="px-2 py-0.5 bg-emerald-600 text-white rounded font-bold text-[10px]">儲存</button>
                                            </div>
                                          </div>
                                        ) : (
                                          <>
                                            <div className="flex items-center space-x-4">
                                              <span className="font-bold text-slate-800 dark:text-slate-200">👤 代理人：<span className="text-indigo-600 dark:text-indigo-400 font-extrabold">{subSeg.proxyName}</span></span>
                                              <span className="font-medium text-slate-500 font-mono bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">⏰ 代理時間區間：{subSeg.startHour} ~ {subSeg.endHour}</span>
                                            </div>
                                            <div className="flex items-center space-x-2 ml-auto opacity-0 group-hover/sub:opacity-100 transition-opacity">
                                              <button 
                                                type="button" 
                                                onClick={() => {
                                                  setEditingSubRecordIdx(`${item.uniqueId}_${subIdx}`);
                                                  setSubEditForm({ proxyName: subSeg.proxyName, startHour: subSeg.startHour, endHour: subSeg.endHour });
                                                }}
                                                className="p-1 text-slate-400 hover:text-indigo-600 rounded transition-colors"
                                                title="就地編輯修改此段代理時間"
                                              >
                                                <Edit2 size={12} />
                                              </button>
                                              <button 
                                                type="button" 
                                                onClick={() => handleDeleteSubSegment(item, subIdx)}
                                                className="p-1 text-slate-400 hover:text-red-500 rounded transition-colors"
                                                title="移除此段代理"
                                              >
                                                <Trash2 size={12} />
                                              </button>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex justify-end"><button onClick={() => { setIsProxyExceptionDetailsOpen(false); setAssigningId(null); setEditingSubRecordIdx(null); }} className="px-6 py-2 bg-slate-200 text-slate-700 hover:bg-slate-300 font-bold rounded-xl text-xs">關閉審查視窗</button></div>
          </div>
        </div>
      )}

      {/* 2. 規政代理與合規防呆設定視窗 */}
      {isProxySettingsModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400"><Sliders size={18} /></div>
                <div>
                  <h3 className="font-bold text-base text-slate-800 dark:text-white">規政代理與合規門檻防呆設定</h3>
                  <p className="text-xs text-slate-400 mt-0.5">獨立管理本計畫之請假天數與排除計算單位限制門檻。</p>
                </div>
              </div>
              <button onClick={() => setIsProxySettingsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors"><X size={20} /></button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6 bg-slate-50 dark:bg-slate-900/10">
              <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">1. 連續請假天數門檻</label>
                  <div className="flex items-center space-x-3">
                    <span className="text-xs text-slate-400">連續請假超過</span>
                    <input type="number" min="1" value={proxyThresholdDays} onChange={e => setProxyThresholdDays(parseInt(e.target.value, 10) || 1)} className="w-16 p-2 bg-slate-50 dark:bg-slate-900 border rounded-xl text-center font-bold text-sm text-indigo-600 focus:border-indigo-500 outline-none" />
                    <span className="text-xs text-slate-400">天，即必須排定職務代理人</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-dashed">
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">2. 連續請假中間「包含例假日/放假日」是否併入計算？</label>
                  <button type="button" onClick={() => setIncludeHolidays(!includeHolidays)} className="flex items-center space-x-2 text-xs font-bold transition-colors">
                    {includeHolidays ? (
                      <><ToggleRight size={30} className="text-indigo-600" /><span className="text-indigo-600">併入計算 (假日前後相連視為連續)</span></>
                    ) : (
                      <><ToggleLeft size={30} className="text-slate-400" /><span className="text-slate-400">排除計算 (假日自動切斷連續鏈條)</span></>
                    )}
                  </button>
                </div>

                <div className="pt-2 border-t border-dashed">
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">3. 當月累計天數門檻</label>
                  <div className="flex items-center space-x-3">
                    <span className="text-xs text-slate-400">當月累計請假超過</span>
                    <input type="number" min="1" value={monthlyThresholdDays} onChange={e => setMonthlyThresholdDays(parseInt(e.target.value, 10) || 1)} className="w-16 p-2 bg-slate-50 dark:bg-slate-900 border rounded-xl text-center font-bold text-sm text-indigo-600 focus:border-indigo-500 outline-none" />
                    <span className="text-xs text-slate-400">天，該月份後續請假皆須排定代理</span>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-2.5">
                  4. 免除代理假別設定
                </label>
                <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl border">
                  {ALL_LEAVE_TYPES.map(type => {
                    const isExempt = exemptLeaveTypes.includes(type);
                    return (
                      <label key={type} className={`flex items-center space-x-3 p-2.5 rounded-xl border cursor-pointer transition-colors text-xs font-bold ${isExempt ? 'bg-indigo-50 border-indigo-200 dark:bg-indigo-950/20 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-400' : 'bg-white border-slate-200 dark:bg-slate-800 text-slate-500'}`}>
                        <input type="checkbox" className="sr-only" checked={isExempt} onChange={() => handleToggleExemptLeave(type)} />
                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${isExempt ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300'}`}>
                          {isExempt && <Check size={12} />}
                        </div>
                        <span>{type} {isExempt ? "(免排代理)" : "(須排代理)"}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-2.5">
                  5. 免除代理之計畫單位設定
                </label>
                {allExistingUnits.length === 0 ? (
                  <p className="text-xs text-slate-400 italic bg-slate-50 p-3 rounded-xl border text-center">計畫目前尚無已建檔的人事單位資料。</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl border">
                    {allExistingUnits.map(unitName => {
                      const isUnitExempt = exemptUnits.includes(unitName);
                      return (
                        <label key={unitName} className={`flex items-center space-x-3 p-2.5 rounded-xl border cursor-pointer transition-colors text-xs font-bold ${isUnitExempt ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400' : 'bg-white border-slate-200 dark:bg-slate-800 text-slate-500'}`}>
                          <input type="checkbox" className="sr-only" checked={isUnitExempt} onChange={() => handleToggleExemptUnit(unitName)} />
                          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${isUnitExempt ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-300'}`}>
                            {isUnitExempt && <Check size={12} />}
                          </div>
                          <span>{unitName} {isUnitExempt ? "(免除代理)" : "(常態考核)"}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
            <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex justify-end"><button onClick={() => setIsProxySettingsModalOpen(false)} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center"><Check size={14} className="mr-1" />套用合規設定</button></div>
          </div>
        </div>
      )}

      <AttendanceImportModal isOpen={isAttendanceImportOpen} onClose={() => setIsAttendanceImportOpen(false)} selectedProject={selectedProject} projectName={projectName} />
      <AttendanceViewModal isOpen={isAttendanceViewOpen} onClose={() => setIsAttendanceViewOpen(false)} selectedProject={selectedProject} personnel={personnel} allExistingUnits={[...new Set(personnel.map(p => p.unit))]} />
      <WorkCalendarSettingsModal isOpen={isCalendarSettingsOpen} onClose={() => setIsCalendarSettingsOpen(false)} selectedProject={selectedProject} />
    </div>
  );
}
