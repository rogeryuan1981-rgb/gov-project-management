import React, { useState, useEffect } from 'react';
import { Clock, Upload, CalendarDays, ShieldAlert, AlertCircle, ChevronRight, CheckCircle2, Sliders, ToggleLeft, ToggleRight, Check } from 'lucide-react';
import { collection, onSnapshot, doc, getFirestore } from 'firebase/firestore'; 
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

  // 💡 1. 代理規則手動配置狀態 (預設值完全符合公務體系標準，可自由即時切換)
  const [proxyThresholdDays, setProxyThresholdDays] = useState(2); // 連續超過幾天請假需要代理
  const [includeHolidays, setIncludeHolidays] = useState(false); // 中間隔假日算不算
  const [monthlyThresholdDays, setMonthlyThresholdDays] = useState(5); // 當月累計超過幾天需要代理
  
  // 哪些假別當天「不用安排代理」，但在判定連續與累計天數時「仍須計入」
  const [exemptLeaveTypes, setExemptLeaveTypes] = useState(['特休', '補休']);

  // 全方位假別清單，供使用者勾選
  const ALL_LEAVE_TYPES = ['特休', '事假', '病假', '喪假', '公出', '補休'];

  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [currentOffDays, setCurrentOffDays] = useState({});

  const today = new Date().toISOString().split('T')[0];
  const todayYearMonth = today.substring(0, 7);

  useEffect(() => {
    if (!user || !selectedProject) return;
    setDbError(null);

    const projectRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'projects', selectedProject);
    const unsubProject = onSnapshot(projectRef, (docSnap) => {
      if (docSnap.exists()) setProjectName(docSnap.data().name);
    });

    const hrRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'personnel');
    const reqRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'manpower_reqs');
    
    // 監聽打卡流水號紀錄，供代理異常時數實時動態精算
    const attRecordsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'attendance_records');
    const qAtt = query(attRecordsRef, where('projectId', '==', selectedProject), where('month', '==', todayYearMonth));
    
    const unsubAtt = onSnapshot(attRecordsRef, (snapshot) => {
      const loadedAtt = snapshot.docs.map(doc => doc.data()).filter(r => r.projectId === selectedProject && r.month === todayYearMonth);
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

  // =========================================================================
  // 🧠 核心代理合規異常時數精算引擎 (動態滾動判定)
  // =========================================================================
  const calculateProxyExceptionHours = () => {
    let totalExceptionHours = 0;
    
    const year = parseInt(todayYearMonth.split('-')[0], 10);
    const month = parseInt(todayYearMonth.split('-')[1], 10);
    const daysInMonth = new Date(year, month, 0).getDate();

    personnel.forEach(person => {
      let monthlyLeaveCount = 0;
      let continuousLeaveChain = 0;

      // 逐日建立該同仁在當月的請假快照
      const monthLeaveMap = {};
      const monthProxyMap = {}; // 是否有安排代理人

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayRecord = attendanceRecords.find(r => r.name === person.name && r.date === dateStr);
        
        if (dayRecord && dayRecord.leaveType) {
          monthLeaveMap[d] = dayRecord.leaveType;
          // 假設流水號內代理人欄位有填寫非空字串，視為已安排代理
          monthProxyMap[d] = !!(dayRecord.proxyName || dayRecord.proxyNameField); 
        } else {
          monthLeaveMap[d] = null;
          monthProxyMap[d] = false;
        }
      }

      // 逐日進行智慧鏈條推演
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isOffDay = !!currentOffDays[dateStr];
        const leaveType = monthLeaveMap[d];
        const hasProxy = monthProxyMap[d];

        if (isOffDay) {
          if (includeHolidays) {
            // 如果中間隔假日算進連續，則假日不切斷鏈條（但放假日當天不加計時數也不扣款）
          } else {
            continuousLeaveChain = 0; // 假日切斷連續請假鏈條
          }
          continue;
        }

        if (leaveType) {
          monthlyLeaveCount++;
          continuousLeaveChain++;

          // 核心條件交叉審查：是否觸發「需要安排代理」的法規門檻
          const needProxyByContinuous = continuousLeaveChain > proxyThresholdDays;
          const needProxyByMonthly = monthlyLeaveCount > monthlyThresholdDays;

          if (needProxyByContinuous || needProxyByMonthly) {
            // 審查當天的假別是不是免除代理排班的假別 (例如特休)
            const isExemptToday = exemptLeaveTypes.includes(leaveType);
            
            if (!isExemptToday) {
              // 當天假別不能免除，且沒有安排代理，判定為合規代理異常！
              if (!hasProxy) {
                totalExceptionHours += 8; // 單日計罰或待補件時數以 8 小時為基準累加
              }
            }
          }
        } else {
          // 當天沒請假正常到工，重設連續請假鏈條
          continuousLeaveChain = 0;
        }
      }
    });

    return totalExceptionHours;
  };

  const totalProxyExceptionHours = calculateProxyExceptionHours();

  const handleToggleExemptLeave = (type) => {
    if (exemptLeaveTypes.includes(type)) {
      setExemptLeaveTypes(exemptLeaveTypes.filter(t => t !== type));
    } else {
      setExemptLeaveTypes([...exemptLeaveTypes, type]);
    }
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

      {/* 💡 頂部管理數據面板：文字與單位已全面升級 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className={`bg-white dark:bg-slate-800 p-6 rounded-2xl border shadow-sm flex items-center space-x-5 transition-colors ${totalProxyExceptionHours > 0 ? 'border-orange-200 dark:border-orange-500/30' : 'border-slate-200 dark:border-slate-700/50'}`}>
          <div className={`p-3.5 rounded-xl ${totalProxyExceptionHours > 0 ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400' : 'bg-slate-50 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500'}`}>
            <AlertCircle size={28} />
          </div>
          <div>
            {/* 💡 修正2：文字改成 代理異常，單位由件改成小時 */}
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-1">代理異常</p>
            <p className={`text-3xl font-black ${totalProxyExceptionHours > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-800 dark:text-white'}`}>
              {totalProxyExceptionHours} <span className="text-sm font-medium text-slate-500">小時</span>
            </p>
          </div>
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

        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex items-center justify-between">
          <div className="flex items-center space-x-5">
            <div className="p-3.5 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">考勤查核總量</p>
              <p className="text-sm font-black text-slate-800 dark:text-white">已連結 {personnel.length} 位在職名冊</p>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          💡 全新加開：規政代理與合規防呆主動設定面板 (100% 全量代碼展開)
         ========================================================================= */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-indigo-100 dark:border-indigo-500/20 shadow-sm">
        <div className="flex items-center space-x-3 mb-5 border-b border-slate-100 dark:border-slate-700 pb-3">
          <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400"><Sliders size={18} /></div>
          <div>
            <h3 className="font-bold text-base text-slate-800 dark:text-white">規政代理與合規門檻防呆設定</h3>
            <p className="text-xs text-slate-400 mt-0.5">自訂計畫請假聯動代理機制，系統將依此標準實時清洗全月打卡明細並產出異常時數。</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">1. 連續請假天數門檻</label>
              <div className="flex items-center space-x-3">
                <span className="text-xs text-slate-400">連續請假超過</span>
                <input type="number" min="1" value={proxyThresholdDays} onChange={e => setProxyThresholdDays(parseInt(e.target.value, 10) || 1)} className="w-16 p-1.5 bg-slate-50 dark:bg-slate-900 border rounded-lg text-center font-bold text-sm text-indigo-600 focus:border-indigo-500 outline-none" />
                <span className="text-xs text-slate-400">天，即必須排定職務代理人</span>
              </div>
            </div>

            <div className="pt-2">
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">2. 連續請假中間「包含例假日/放假日」是否併入計算？</label>
              <button type="button" onClick={() => setIncludeHolidays(!includeHolidays)} className="flex items-center space-x-2 text-xs font-bold transition-colors">
                {includeHolidays ? (
                  <><ToggleRight size={28} className="text-indigo-600" /><span className="text-indigo-600">併入計算 (假日前後相連視為連續)</span></>
                ) : (
                  <><ToggleLeft size={28} className="text-slate-400" /><span className="text-slate-400">排除計算 (假日自動切斷連續鏈條)</span></>
                )}
              </button>
            </div>

            <div className="pt-2">
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">3. 當月累計天數門檻</label>
              <div className="flex items-center space-x-3">
                <span className="text-xs text-slate-400">當月累計請假超過</span>
                <input type="number" min="1" value={monthlyThresholdDays} onChange={e => setMonthlyThresholdDays(parseInt(e.target.value, 10) || 1)} className="w-16 p-1.5 bg-slate-50 dark:bg-slate-900 border rounded-lg text-center font-bold text-sm text-indigo-600 focus:border-indigo-500 outline-none" />
                <span className="text-xs text-slate-400">天，該月份後續請假皆須排定代理</span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">
              4. 免除代理假別設定 (💡 當天免代理，但仍須併入上述連續及累計天數計算)
            </label>
            <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl border">
              {ALL_LEAVE_TYPES.map(type => {
                const isExempt = exemptLeaveTypes.includes(type);
                return (
                  <label key={type} className={`flex items-center space-x-3 p-2 rounded-xl border cursor-pointer transition-colors text-xs font-bold ${isExempt ? 'bg-indigo-50 border-indigo-200 dark:bg-indigo-950/20 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-400' : 'bg-white border-slate-200 dark:bg-slate-800 text-slate-500'}`}>
                    <input type="checkbox" className="sr-only" checked={isExempt} onChange={() => handleToggleExemptLeave(type)} />
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${isExempt ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300'}`}>
                      {isExempt && <Check size={12} />}
                    </div>
                    <span>{type} {isExempt ? "(免排代理)" : "(須排代理)"}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
              💡 範例：若核選「特休免排代理」，當同仁前兩天請特休、第三天請事假時，前兩天不會觸發異常，但因特休天數計入鏈條，第三天事假若符合連續/累計要求且未排代理，將精準計算 8 小時異常。
            </p>
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
        <button onClick={() => setAttendanceSubTab('exception')} className="px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center bg-white dark:bg-slate-800 text-red-600 shadow-sm"><ShieldAlert size={14} className="inline mr-1" />⚠️ 異常維護面板</button>
        <button onClick={() => setAttendanceSubTab('full_calendar')} className="px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center text-slate-500 hover:text-slate-700"><CalendarDays size={14} className="inline mr-1" />📅 全月日曆總覽</button>
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

      <AttendanceImportModal isOpen={isAttendanceImportOpen} onClose={() => setIsAttendanceImportOpen(false)} selectedProject={selectedProject} projectName={projectName} />
      <AttendanceViewModal isOpen={isAttendanceViewOpen} onClose={() => setIsAttendanceViewOpen(false)} selectedProject={selectedProject} personnel={personnel} allExistingUnits={[...new Set(personnel.map(p => p.unit))]} />
      <WorkCalendarSettingsModal isOpen={isCalendarSettingsOpen} onClose={() => setIsCalendarSettingsOpen(false)} selectedProject={selectedProject} />
    </div>
  );
}
