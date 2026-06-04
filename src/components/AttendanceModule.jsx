import React, { useState, useEffect } from 'react';
import { Clock, Upload, CalendarDays, ShieldAlert, AlertCircle, ChevronRight, CheckCircle2 } from 'lucide-react';
import { collection, onSnapshot, doc, getFirestore } from 'firebase/firestore'; // 💡 已經精確補上 doc 引入
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

  const today = new Date().toISOString().split('T')[0];
  const todayMs = new Date(today).getTime();

  useEffect(() => {
    if (!user || !selectedProject) return;
    setDbError(null);

    const projectRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'projects', selectedProject);
    const unsubProject = onSnapshot(projectRef, (docSnap) => {
      if (docSnap.exists()) setProjectName(docSnap.data().name);
    });

    const hrRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'personnel');
    const reqRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'manpower_reqs');
    
    const unsubHR = onSnapshot(hrRef, (snapshot) => {
      const loadedData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPersonnel(loadedData.filter(p => p.projectId === selectedProject));
      setIsDataLoaded(true);
    }, (error) => { if (error.code === 'permission-denied') setDbError('【權限不足】讀取人員資料失敗'); });

    const unsubReq = onSnapshot(reqRef, (snapshot) => {
      setRequirements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(r => r.projectId === selectedProject));
    });

    return () => { unsubProject(); unsubHR(); unsubReq(); };
  }, [user, selectedProject]);

  const getPersonStatus = (p) => {
    const startMs = new Date(p.contractStart || p.hireDate).getTime();
    const endMs = p.contractEnd ? new Date(p.contractEnd).getTime() : Infinity;
    if (startMs > todayMs) return 'pending';
    if (endMs < todayMs) return 'inactive'; 
    return 'active';
  };

  const proxyAlertCount = personnel.filter(p => p.proxyAlert && getPersonStatus(p) === 'active').length;

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className={`bg-white dark:bg-slate-800 p-6 rounded-2xl border shadow-sm flex items-center space-x-5 transition-colors ${proxyAlertCount > 0 ? 'border-orange-200 dark:border-orange-500/30' : 'border-slate-200 dark:border-slate-700/50'}`}>
          <div className={`p-3.5 rounded-xl ${proxyAlertCount > 0 ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400' : 'bg-slate-50 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500'}`}>
            <AlertCircle size={28} />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-1">規政代理異常待補件</p>
            <p className={`text-3xl font-black ${proxyAlertCount > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-800 dark:text-white'}`}>
              {proxyAlertCount} <span className={`text-sm font-medium ${proxyAlertCount > 0 ? 'text-orange-500' : 'text-slate-500'}`}>件</span>
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
              <p className="text-sm font-black text-slate-800 dark:text-white">點擊設定應上班日禮與假期</p>
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
        <button onClick={() => setAttendanceSubTab('exception')} className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${attendanceSubTab === 'exception' ? 'bg-white dark:bg-slate-800 text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><ShieldAlert size={14} className="inline mr-1" />⚠️ 異常維護面板</button>
        <button onClick={() => setAttendanceSubTab('full_calendar')} className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${attendanceSubTab === 'full_calendar' ? 'bg-white dark:bg-slate-800 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><CalendarDays size={14} className="inline mr-1" />📅 全月日曆總覽</button>
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
