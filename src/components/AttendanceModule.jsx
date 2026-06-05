import React, { useState, useEffect } from 'react';
import { Clock, Upload, CalendarDays, ShieldAlert, AlertCircle, ChevronRight, CheckCircle2, Sliders, ToggleLeft, ToggleRight, Check, X, UserCheck, Save, Calendar, Trash2, Edit2, Plus } from 'lucide-react';
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

  // 💡 【全新擴充狀態】：使用者可自行定義擴充的假別對齊字典別名物件
  const [leaveAliasMapping, setLeaveAliasMapping] = useState([
    { alias: '休假', official: '特休' },
    { alias: '補休假', official: '補休' }
  ]);
  const [newAliasInput, setNewAliasInput] = useState('');
  const [newOfficialSelect, setNewOfficialSelect] = useState('特休');

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

  // 實時精算扣除「12:30 - 13:30」中午休息工時之有效分鐘數函數
  const getEffectiveMinutes = (startStr, endStr) => {
    const startM = timeToMinutes(startStr);
    const endM = timeToMinutes(endStr);
    if (endM <= startM) return 0;

    let totalMinutes = endM - startM;
    const breakStart = 12 * 60 + 30; 
    const breakEnd = 13 * 60 + 30;   

    const overlapStart = Math.max(startM, breakStart);
    const overlapEnd = Math.min(endM, breakEnd);

    if (overlapEnd > overlapStart) {
      totalMinutes -= (overlapEnd - overlapStart);
    }
    return totalMinutes;
  };

  // 智慧清洗時間字串，只抓取單日 HH:MM~HH:MM 區間，防爆表格並相容 C 表民國曆
  const cleanTimeRangeOnly = (rangeStr) => {
    if (!rangeStr) return '';
    const timePattern = /(\d{2}:\d{2})/g;
    const matches = rangeStr.match(timePattern);
    if (matches && matches.length >= 2) {
      return `${matches[0]} ~ ${matches[1]}`;
    }
    return rangeStr.replace(/\s+/g, '');
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
  // 🧠 核心重構：動態自訂假別別名歸納對齊之代理異常精算引擎
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
        const dayRecords = attendanceRecords.filter(r => r.name === person.name && r.date === dateStr);
        
        if (dayRecords.length > 0) {
          let lType = dayRecords.find(r => r.leaveType)?.leaveType || "";
          if (!lType) {
            const rangeRec = dayRecords.find(r => r.leaveRangeInfo && (r.leaveRangeInfo.includes('假') || r.leaveRangeInfo.includes('休')));
            if (rangeRec) {
              if (rangeRec.leaveRangeInfo.includes('事假')) lType = '事假';
              else if (rangeRec.leaveRangeInfo.includes('病假')) lType = '病假';
              else if (rangeRec.leaveRangeInfo.includes('喪假')) lType = '喪假';
              else if (rangeRec.leaveRangeInfo.includes('休')) lType = '特休';
              else if (rangeRec.leaveRangeInfo.includes('補休')) lType = '補休';
            }
          }

          // 💡 智慧動態清洗字典對齊線線：根據使用者在畫面上設定的 Mapping 動態對齊
          const matchedMapping = leaveAliasMapping.find(m => m.alias === lType);
          if (matchedMapping) {
            lType = matchedMapping.official; // 動態映射為官方核心假別 (如 補休假 -> 補休)
          }

          monthLeaveMap[d] = lType || null;
          monthRecordMap[d] = dayRecords[0]; 
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
              const requiredMinutes = 8 * 60;
              let totalCoveredMinutes = 0;

              const dayRecords = attendanceRecords.filter(r => r.name === person.name && r.date === dateStr);
              let segments = [];
              dayRecords.forEach(r => {
                if (r.proxySegments && r.proxySegments.length > 0) segments = [...segments, ...r.proxySegments];
              });

              if (segments.length === 0) {
                const legacyProxyName = dayRecords.find(r => r.proxyName)?.proxyName;
                const legacyRange = dayRecords.find(r => r.leaveRangeInfo)?.leaveRangeInfo || "08:30~17:30";
                
                if (legacyProxyName) {
                  const cleanedRange = cleanTimeRangeOnly(legacyRange);
                  if (cleanedRange.includes('~')) {
                    const p = cleanedRange.split('~');
                    totalCoveredMinutes += getEffectiveMinutes(p[0], p[1]);
                  } else {
                    totalCoveredMinutes += requiredMinutes; 
                  }
                }
              } else {
                segments.forEach(seg => {
                  totalCoveredMinutes += getEffectiveMinutes(seg.startHour, seg.endHour);
                });
              }

              const uncoveredMinutes = Math.max(0, requiredMinutes - totalCoveredMinutes);
              const uncoveredHours = Math.ceil(uncoveredMinutes / 60);

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
                  uncoveredHours: uncoveredHours, 
                  proxySegments: segments, 
                  triggerReason: `代理時數不足！當天應代理 8 小時（扣除12:30-13:30休息），目前有效代理 ${Math.round(totalCoveredMinutes/60*10)/10} 小時，尚缺 ${uncoveredHours} 小時。`
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

  const handleAddAliasRecord = () => {
    if (!newAliasInput.trim()) return;
    if (leaveAliasMapping.some(m => m.alias === newAliasInput.trim())) {
      alert("此別名已經定義過，請勿重複添加！");
      return;
    }
    setLeaveAliasMapping([...leaveAliasMapping, { alias: newAliasInput.trim(), official: newOfficialSelect }]);
    setNewAliasInput('');
  };

  const handleRemoveAliasRecord = (alias) => {
    setLeaveAliasMapping(leaveAliasMapping.filter(m => m.alias !== alias));
  };

  // 新增代理時段
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

      const currentSegments = baseData.proxySegments || [];
      const newSegment = {
        proxyName: assignForm.proxyName.trim(),
        startHour: assignForm.startHour,
        endHour: assignForm.endHour,
        createdAt: new Date().getTime()
      };

      const updatedSegments = [...currentSegments, newSegment];

      await setDoc(docRef, {
        ...baseData,
        projectId: selectedProject,
        month: todayYearMonth,
        name: item.name,
        date: item.date,
        leaveType: item.leaveType,
        proxySegments: updatedSegments, 
        proxyName: updatedSegments.map(s => s.proxyName).join(', '), 
        isManualMaintained: true, 
        updatedAt: new Date().getTime()
      }, { merge: true });
      setAssignForm({ proxyName: '', startHour: '08:30', endHour: '17:30' });
      alert(`✅ 成功為 ${item.name} 新增排代時段！`);
    } catch (e) { alert("指派代理失敗"); }
  };

  // 修改分段代理人
  const handleUpdateSubSegment = async (item, subIdx) => {
    if (!subEditForm.proxyName.trim()) { alert("代理人名不可為空！"); return; }
    try {
      const attRecordsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'attendance_records');
      const docRef = doc(attRecordsRef, item.realDocId);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) return;

      const baseData = docSnap.data();
      const segments = [...(baseData.proxySegments || [])];
      segments[subIdx] = { proxyName: subEditForm.proxyName.trim(), startHour: subEditForm.startHour, endHour: subEditForm.endHour, updatedAt: new Date().getTime() };

      await updateDoc(docRef, { proxySegments: segments, proxyName: segments.map(s => s.proxyName).join(', '), updatedAt: new Date().getTime() });
      setEditingSubRecordIdx(null);
      alert("✅ 代理時段維護成功！");
    } catch (e) { console.error(e); }
  };

  // 刪除分段代理人
  const handleDeleteSubSegment = async (item, subIdx) => {
    if (!confirm("確定要刪除這段代理嗎？")) return;
    try {
      const attRecordsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'attendance_records');
      const docRef = doc(attRecordsRef, item.realDocId);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) return;

      const baseData = docSnap.data();
      const segments = (baseData.proxySegments || []).filter((_, i) => i !== subIdx);
      await updateDoc(docRef, { proxySegments: segments, proxyName: segments.map(s => s.proxyName).join(', '), updatedAt: new Date().getTime() });
      alert("🗑️ 代理時段移除成功。");
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
        <div onClick={() => totalProxyExceptionHours > 0 && setIsProxyExceptionDetailsOpen(true)} className={`bg-white dark:bg-slate-800 p-6 rounded-2xl border shadow-sm flex items-center justify-between transition-all ${totalProxyExceptionHours > 0 ? 'border-orange-200 dark:border-orange-500/30 cursor-pointer hover:border-orange-400 dark:hover:border-orange-500/50 group' : 'border-slate-200 dark:border-slate-700/50'}`}>
          <div className="flex items-center space-x-5">
            <div className={`p-3.5 rounded-xl transition-transform ${totalProxyExceptionHours > 0 ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 group-hover:scale-110' : 'bg-slate-50 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500'}`}><AlertCircle size={28} /></div>
            <div>
              <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-1">代理異常</p>
              <p className={`text-3xl font-black ${totalProxyExceptionHours > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-800 dark:text-white'}`}>{totalProxyExceptionHours} <span className="text-sm font-medium text-slate-500">小時</span></p>
            </div>
          </div>
          {totalProxyExceptionHours > 0 && <div className="text-orange-500 dark:text-orange-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1"><span className="text-xs font-bold">點擊補登代理時段</span><ChevronRight size={14} /></div>}
        </div>
        
        <div onClick={() => setIsCalendarSettingsOpen(true)} className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex items-center justify-between cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500/50 transition-colors group">
          <div className="flex items-center space-x-5">
            <div className="p-3.5 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform"><CalendarDays size={24} /></div>
            <div><p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">工作日曆與法定假別設定</p><p className="text-sm font-black text-slate-800 dark:text-white">點擊設定應上班日曆與假期</p></div>
          </div>
          <div className="text-indigo-500 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity"><ChevronRight size={16} /></div>
        </div>

        <div onClick={() => setIsProxySettingsModalOpen(true)} className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex items-center justify-between cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500/50 transition-colors group">
          <div className="flex items-center space-x-5">
            <div className="p-3.5 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform"><Sliders size={24} /></div>
            <div><p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">規政代理與合規防呆設定</p><p className="text-sm font-black text-slate-800 dark:text-white">點擊設定連續與累計請假天數</p></div>
          </div>
          <div className="text-indigo-500 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity"><ChevronRight size={16} /></div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-slate-800 dark:text-white mb-1">匯入最新打卡 CSV</h3>
          <p className="text-sm text-slate-500">支援 A/C 表格式，系統會自動比對並鎖定人工補登資料。</p>
        </div>
        <div className="flex items-center space-x-3 shrink-0"><button onClick={() => setIsAttendanceImportOpen(true)} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all">匯入考勤 CSV</button></div>
      </div>

      <div className="flex border-b border-slate-200 dark:border-slate-700 space-x-1 p-1 rounded-xl w-fit bg-slate-100/60 dark:bg-slate-900/40">
        <button onClick={() => setAttendanceSubTab('exception')} className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center ${attendanceSubTab === 'exception' ? 'bg-white dark:bg-slate-800 text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><ShieldAlert size={14} className="inline mr-1" />⚠️ 異常維護面板</button>
        <button onClick={() => setAttendanceSubTab('full_calendar')} className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center ${attendanceSubTab === 'full_calendar' ? 'bg-white dark:bg-slate-800 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><CalendarDays size={14} className="inline mr-1" />📅 全月日曆總覽</button>
      </div>

      <div className="attendance-sub-tab-content">
        {attendanceSubTab === 'exception' ? <AttendanceExceptionManager selectedProject={selectedProject} personnel={personnel} /> : (
          <div className="bg-white dark:bg-slate-800 p-8 text-center rounded-2xl border dark:border-slate-700">
             <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">您可以一鍵展開包含特赦鎖定狀態的差假總覽：</p>
             <button onClick={() => setIsAttendanceViewOpen(true)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl transition-all">🔍 開啟全月覆核大彈窗</button>
          </div>
        )}
      </div>

      {/* 代理異常案件維護彈窗 */}
      {isProxyExceptionDetailsOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 w-full max-w-5xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
              <div>
                <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center"><ShieldAlert size={20} className="mr-2 text-orange-500" />特定假別代理異常案件審查中心</h3>
              </div>
              <button onClick={() => { setIsProxyExceptionDetailsOpen(false); setAssigningId(null); setEditingSubRecordIdx(null); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors"><X size={20} /></button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-900/20">
              <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm bg-white dark:bg-slate-800">
                <table className="w-full text-left border-collapse table-fixed text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-500">
                    <tr>
                      <th className="py-3 px-4 w-[100px]">請假日期</th>
                      <th className="py-3 px-4 w-[130px]">姓名/組別</th>
                      <th className="py-3 px-4 w-[85px]">假別屬性</th>
                      <th className="py-3 px-4">系統差假代理核對歷程</th>
                      <th className="py-3 px-4 text-right w-[240px]">核心手動分段派代作業</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 text-slate-700 dark:text-slate-200 font-medium">
                    {proxyExceptionList.map(item => {
                      const isAssigning = assigningId === item.uniqueId;
                      const currentSubSegments = item.proxySegments || [];
                      return (
                        <tr key={item.uniqueId} className={`hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors ${isAssigning ? 'bg-indigo-50/40 dark:bg-indigo-950/20' : ''}`}>
                          <td className="py-4 px-4 font-bold font-mono text-slate-900 dark:text-slate-100">{item.date}</td>
                          <td className="py-4 px-4">
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-900 dark:text-slate-100">{item.name}</span>
                              <span className="text-[10px] text-slate-400 font-semibold">{item.unit}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4"><span className="px-2 py-0.5 bg-red-50 text-red-700 rounded-md font-bold">{item.leaveType}</span></td>
                          <td className="py-4 px-4 space-y-3">
                            <div className="bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-xl border border-dashed">
                              <div>{item.triggerReason}</div>
                              <div className="text-[10px] text-orange-600 font-extrabold mt-1">⚠️ 今日狀態：仍缺少 {item.uncoveredHours} 小時尚未指派完全。</div>
                            </div>
                            {currentSubSegments.length > 0 && (
                              <div className="bg-slate-100/70 dark:bg-slate-900 p-3 rounded-xl border space-y-1.5">
                                {currentSubSegments.map((subSeg, subIdx) => {
                                  const isSubEditing = editingSubRecordIdx === `${item.uniqueId}_${subIdx}`;
                                  return (
                                    <div key={subIdx} className="flex items-center justify-between bg-white dark:bg-slate-800 p-2 border rounded-lg text-[11px] shadow-2xs group/sub">
                                      {isSubEditing ? (
                                        <div className="flex items-center gap-1.5 w-full">
                                          <input type="text" value={subEditForm.proxyName} onChange={e => setSubEditForm({...subEditForm, proxyName: e.target.value})} className="px-1.5 py-0.5 border rounded w-16" />
                                          <input type="text" value={subEditForm.startHour} onChange={e => setSubEditForm({...subEditForm, startHour: e.target.value})} className="px-1 py-0.5 border rounded w-12 text-center" />
                                          <input type="text" value={subEditForm.endHour} onChange={e => setSubEditForm({...subEditForm, endHour: e.target.value})} className="px-1 py-0.5 border rounded w-12 text-center" />
                                          <button type="button" onClick={() => handleUpdateSubSegment(item, subIdx)} className="px-1.5 py-0.5 bg-emerald-600 text-white rounded text-[10px]">💾</button>
                                        </div>
                                      ) : (
                                        <>
                                          <div><span className="font-extrabold text-indigo-600">{subSeg.proxyName}</span> <span className="text-slate-400">({subSeg.startHour}~{subSeg.endHour})</span></div>
                                          <div className="flex space-x-1 opacity-0 group-hover/sub:opacity-100 transition-opacity">
                                            <button type="button" onClick={() => { setEditingSubRecordIdx(`${item.uniqueId}_${subIdx}`); setSubEditForm({ proxyName: subSeg.proxyName, startHour: subSeg.startHour, endHour: subSeg.endHour }); }} className="text-slate-400 hover:text-indigo-600"><Edit2 size={11}/></button>
                                            <button type="button" onClick={() => handleDeleteSubSegment(item, subIdx)} className="text-slate-400 hover:text-red-500"><Trash2 size={11}/></button>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                          <td className="py-4 px-4 text-right">
                            {isAssigning ? (
                              <div className="space-y-2 p-3 bg-white dark:bg-slate-900 border rounded-xl w-full text-left">
                                <input type="text" value={assignForm.proxyName} onChange={e => setAssignForm({...assignForm, proxyName: e.target.value})} placeholder="代理人姓名" className="w-full px-2 py-1 border text-xs" />
                                <div className="grid grid-cols-2 gap-1">
                                  <input type="text" value={assignForm.startHour} onChange={e => setAssignForm({...assignForm, startHour: e.target.value})} className="w-full px-1 py-0.5 text-center text-xs" />
                                  <input type="text" value={assignForm.endHour} onChange={e => setAssignForm({...assignForm, endHour: e.target.value})} className="w-full px-1 py-0.5 text-center text-xs" />
                                </div>
                                <div className="flex justify-end space-x-1"><button type="button" onClick={() => setAssigningId(null)} className="px-2 py-0.5 bg-slate-100 text-[10px]">取消</button><button type="button" onClick={() => handleSaveProxyAssignment(item)} className="px-2 py-0.5 bg-indigo-600 text-white text-[10px]">儲存</button></div>
                              </div>
                            ) : <button type="button" onClick={() => { setAssigningId(item.uniqueId); setAssignForm({ proxyName: '', startHour: '08:30', endHour: '16:30' }); }} className="px-2.5 py-1.5 border font-bold text-indigo-600 rounded-xl hover:bg-indigo-50"><UserCheck size={12} className="mr-1"/>指派代理</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. 規政代理與合規防呆設定視窗 */}
      {isProxySettingsModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b bg-slate-50 dark:bg-slate-800 flex justify-between items-center">
              <h3 className="font-bold text-base text-slate-800 dark:text-white flex items-center"><Sliders size={18} className="mr-2" />規政代理與合規門檻防呆設定</h3>
              <button onClick={() => setIsProxySettingsModalOpen(false)} className="text-slate-400 p-1"><X size={20} /></button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6">
              <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2">1. 連續請假天數門檻</label>
                  <div className="flex items-center space-x-3">
                    <span>連續請假超過</span>
                    <input type="number" min="1" value={proxyThresholdDays} onChange={e => setProxyThresholdDays(parseInt(e.target.value, 10) || 1)} className="w-16 p-2 bg-slate-50 border rounded-xl text-center font-bold text-indigo-600 outline-none" />
                    <span>天，即必須排定職務代理人</span>
                  </div>
                </div>
                <div className="pt-2 border-t border-dashed">
                  <label className="block text-xs font-bold text-slate-500 mb-2">2. 連續請假中間「包含例假日/放假日」是否併入計算？</label>
                  <button type="button" onClick={() => setIncludeHolidays(!includeHolidays)} className="flex items-center space-x-2 text-xs font-bold">
                    {includeHolidays ? <><ToggleRight size={30} className="text-indigo-600" /><span>併入計算</span></> : <><ToggleLeft size={30} className="text-slate-400" /><span>排除計算</span></>}
                  </button>
                </div>
                <div className="pt-2 border-t border-dashed">
                  <label className="block text-xs font-bold text-slate-500 mb-2">3. 當月累計天數門檻</label>
                  <div className="flex items-center space-x-3">
                    <span>當月累計請假超過</span>
                    <input type="number" min="1" value={monthlyThresholdDays} onChange={e => setMonthlyThresholdDays(parseInt(e.target.value, 10) || 1)} className="w-16 p-2 bg-slate-50 border rounded-xl text-center font-bold text-indigo-600 outline-none" />
                    <span>天，該月份後續請假皆須排定代理</span>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border">
                <label className="block text-xs font-bold text-slate-500 mb-2.5">4. 免除代理假別設定</label>
                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-4 rounded-2xl border">
                  {ALL_LEAVE_TYPES.map(type => {
                    const isExempt = exemptLeaveTypes.includes(type);
                    return (
                      <label key={type} className={`flex items-center space-x-3 p-2.5 rounded-xl border cursor-pointer text-xs font-bold ${isExempt ? 'bg-indigo-50 text-indigo-700 font-bold' : 'bg-white text-slate-500'}`}>
                        <input type="checkbox" className="sr-only" checked={isExempt} onChange={() => handleToggleExemptLeave(type)} />
                        <span>{type} {isExempt ? "(免排代理)" : "(須排代理)"}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* 💡 5. 【自訂需要被歸納定義的假別別名（如：補休假=補休）管理控制台】 */}
              <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border space-y-4">
                <label className="block text-xs font-bold text-slate-500 mb-1">
                  5. 假別別名歸納定義管理 (💡 用於清洗 CSV 不一致文字，如：輸入「補休假」自動歸納為官方「補休」)
                </label>
                
                <div className="flex flex-wrap items-center gap-3 bg-slate-50 dark:bg-slate-900/60 p-3 rounded-2xl border">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-400 mb-1">CSV 匯入別名文字</span>
                    <input type="text" value={newAliasInput} onChange={e => setNewAliasInput(e.target.value)} placeholder="如：補休假" className="px-2.5 py-1.5 bg-white border rounded-xl text-xs outline-none focus:border-indigo-500 w-36 font-bold" />
                  </div>
                  <span className="text-slate-400 text-xs font-bold mt-4">一律對齊歸納為 $\rightarrow$</span>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-400 mb-1">系統核心官方假別</span>
                    <select value={newOfficialSelect} onChange={e => setNewOfficialSelect(e.target.value)} className="px-2.5 py-1.5 bg-white border rounded-xl text-xs outline-none font-bold text-indigo-600 w-32">
                      {ALL_LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <button type="button" onClick={handleAddAliasRecord} className="mt-4 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center shadow-xs"><Plus size={14} className="mr-1"/>建立對齊規則</button>
                </div>

                <div className="space-y-1.5 max-h-[150px] overflow-y-auto">
                  {leaveAliasMapping.map((mapItem, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-white dark:bg-slate-900 border p-2.5 rounded-xl text-xs">
                      <div>
                        <span className="font-mono bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded text-slate-700 dark:text-slate-300 font-bold">{mapItem.alias}</span>
                        <span className="mx-2 text-slate-400 font-bold">已成功歸納映射至官方 $\rightarrow$</span>
                        <span className="font-bold text-indigo-600 dark:text-indigo-400">{mapItem.official}</span>
                      </div>
                      <button type="button" onClick={() => handleRemoveAliasRecord(mapItem.alias)} className="p-1 text-slate-400 hover:text-red-500 rounded-lg transition-colors"><Trash2 size={13}/></button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border">
                <label className="block text-xs font-bold text-slate-500 mb-2.5">6. 免除代理之計畫單位設定</label>
                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-4 rounded-2xl border">
                  {allExistingUnits.map(unitName => {
                    const isUnitExempt = exemptUnits.includes(unitName);
                    return (
                      <label key={unitName} className={`flex items-center space-x-3 p-2.5 rounded-xl border cursor-pointer text-xs font-bold ${isUnitExempt ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-slate-500'}`}>
                        <input type="checkbox" className="sr-only" checked={isUnitExempt} onChange={() => handleToggleExemptUnit(unitName)} />
                        <span>{unitName}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="p-4 border-t bg-slate-50 flex justify-end"><button onClick={() => setIsProxySettingsModalOpen(false)} className="px-6 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl">套用合規設定</button></div>
          </div>
        </div>
      )}

      <AttendanceImportModal isOpen={isAttendanceImportOpen} onClose={() => setIsAttendanceImportOpen(false)} selectedProject={selectedProject} projectName={projectName} />
      <AttendanceViewModal isOpen={isAttendanceViewOpen} onClose={() => setIsAttendanceViewOpen(false)} selectedProject={selectedProject} personnel={personnel} allExistingUnits={[...new Set(personnel.map(p => p.unit))]} />
      <WorkCalendarSettingsModal isOpen={isCalendarSettingsOpen} onClose={() => setIsCalendarSettingsOpen(false)} selectedProject={selectedProject} />
    </div>
  );
}
