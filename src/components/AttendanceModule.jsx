import React, { useState, useEffect } from 'react';
import { Clock, Upload, CalendarDays, ShieldAlert, AlertCircle, ChevronRight, CheckCircle2 } from 'lucide-react';
import { collection, onSnapshot, getFirestore } from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';

// 引入考勤模組專屬的三個底層彈窗與核心面板
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

  // 💥 實裝考勤模組核心二級頁籤：'exception' = 異常維護面板(預設), 'full_calendar' = 全月日曆總覽模式
  const [attendanceSubTab, setAttendanceSubTab] = useState('exception');

  // 控制考勤獨立內建的彈窗開關
  const [isAttendanceImportOpen, setIsAttendanceImportOpen] = useState(false);
  const [isCalendarSettingsOpen, setIsCalendarSettingsOpen] = useState(false);
  const [isAttendanceViewOpen, setIsAttendanceViewOpen] = useState(false);

  const getLocalTodayStr = () => {
    const d = new Date();
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d - tzOffset).toISOString().split('T')[0];
  };
  const today = getLocalTodayStr();
  const todayMs = new Date(today).getTime();

  // 1. 考勤模組獨立、合規地監聽與撈取計畫名冊與人力需求
  useEffect(() => {
    if (!user || !selectedProject) return;
    setDbError(null);

    const projectRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'projects', selectedProject);
    const unsubProject = onSnapshot(projectRef, (docSnap) => {
      if (docSnap.exists()) {
        setProjectName(docSnap.data().name);
      }
    });

    const hrRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'personnel');
    const reqRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'manpower_reqs');
    
    const unsubHR = onSnapshot(hrRef, (snapshot) => {
      const loadedData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const projectPersonnel = loadedData.filter(p => p.projectId === selectedProject);
      projectPersonnel.sort((a, b) => new Date(b.hireDate) - new Date(a.hireDate));
      setPersonnel(projectPersonnel);
      setIsDataLoaded(true);
    }, (error) => {
      if (error.code === 'permission-denied') setDbError('【權限不足】考勤模組無法讀取人員資料庫');
    });

    const unsubReq = onSnapshot(reqRef, (snapshot) => {
      const loadedReqs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const projectReqs = loadedReqs.filter(r => r.projectId === selectedProject);
      setRequirements(projectReqs);
    }, (error) => {
      if (error.code === 'permission-denied') setDbError('【權限不足】考勤模組無法讀取人力編制');
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

  const availableUnits = [...new Set(requirements.map(r => r.unit))].filter(Boolean);
  const allExistingUnits = [...new Set([...availableUnits, ...personnel.map(p => p.unit)])].filter(Boolean);

  // 計算考勤區塊專屬的：規政代理異常待補件統計
  const proxyAlertCount = personnel.filter(p => p.proxyAlert && getPersonStatus(p) === 'active').length;

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-6xl mx-auto">
      
      {dbError && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-4 rounded-2xl flex items-start animate-in slide-in-from-top-2">
          <AlertCircle className="text-red-500 mr-3 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <h4 className="text-sm font-bold text-red-700 dark:text-red-400">資料連線攔截</h4>
            <p className="text-xs text-red-600 dark:text-red-300 mt-1">{dbError}</p>
          </div>
        </div>
      )}

      {/* 頂部整合控制面板 */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center">
            <Clock className="mr-3 text-indigo-500" size={24} /> 計畫考勤管理中心 ({projectName || '載入中...'})
          </h2>
          <p className="text-sm text-slate-500 mt-1">獨立控管原始打卡流水號。排除放假日，實時審查「未打卡、缺打卡、遲到早退」並提供防覆蓋保護令維護。</p>
        </div>
      </div>

      {/* 考勤大數據資訊看板 */}
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
              <p className="text-sm font-black text-slate-800 dark:text-white">點擊設定應上班日與假期</p>
            </div>
          </div>
          <div className="text-indigo-500 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
            <ChevronRight size={16} />
          </div>
        </div>
      </div>

      {/* 獨立一體化考勤匯入控制大條列 */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-bold text-slate-800 dark:text-white mb-1">上傳最新打卡紀錄流水號</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">支援一體化新版 A 表或單列民國曆 C 表，系統自動媒合人名並執行特赦鎖定攔截。</p>
        </div>
        <div className="flex items-center space-x-3 shrink-0">
          <button 
            onClick={() => setIsAttendanceImportOpen(true)}
            className="flex items-center justify-center space-x-2 px-5 py-2.5 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors text-sm font-bold"
          >
            <Upload size={18} />
            <span>匯入考勤 CSV</span>
          </button>
        </div>
      </div>

      {/* 💥 考勤專屬二級內置頁籤，達成高度收納分流 */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 space-x-1 bg-slate-100/60 dark:bg-slate-900/40 p-1 rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setAttendanceSubTab('exception')}
          className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
            attendanceSubTab === 'exception'
              ? 'bg-white dark:bg-slate-800 text-red-600 dark:text-red-400 shadow-xs'
              : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <ShieldAlert size={14} />
          <span>⚠️ 考勤異常維護面板</span>
        </button>
        
        <button
          type="button"
          onClick={() => setAttendanceSubTab('full_calendar')}
          className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
            attendanceSubTab === 'full_calendar'
              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
              : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <CalendarDays size={14} />
          <span>📅 全月考勤日曆總覽</span>
        </button>
      </div>

      {/* 頁籤對應模組內置面板切換 */}
      <div className="attendance-module-sub-content">
        {attendanceSubTab === 'exception' ? (
          /* A 頁籤分流：全新爆發的異常維護審查面板 */
          <AttendanceExceptionManager 
            selectedProject={selectedProject} 
            personnel={personnel} 
          />
        ) : (
          /* B 頁籤分流：原汁原味呈現 1~31 天大覆核大矩陣 */
          <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 text-center">
            <div className="max-w-md mx-auto py-12 space-y-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                已切換至「全月考勤總覽模式」。您可以點擊下方動作按鈕，一鍵展開全計畫所有同仁橫向 1~31 天完整的考勤比對大矩陣。
              </p>
              <button 
                type="button"
                onClick={() => setIsAttendanceViewOpen(true)}
                className="flex items-center justify-center space-x-2 px-6 py-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-xl hover:shadow-md font-bold text-xs transition-all mx-auto"
              >
                <span>🔍 點擊展開全月考勤覆核大彈窗</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 規政代理異常名單 (原汁原味完整保留留存) */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/80">
          <h3 className="font-bold text-slate-800 dark:text-white">規政代理異常名單</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">人員姓名</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">所屬單位</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">異常狀態</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {personnel.filter(p => p.proxyAlert && getPersonStatus(p) === 'active').length === 0 ? (
                 <tr><td colSpan="4" className="py-12 text-center text-slate-500 dark:text-slate-400 text-sm font-medium">目前無任何代理異常紀錄。</td></tr>
              ) : (
                personnel.filter(p => p.proxyAlert && getPersonStatus(p) === 'active').map(u => (
                  <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="py-4 px-6 font-bold text-slate-900 dark:text-slate-200">{u.name}</td>
                    <td className="py-4 px-6 text-sm text-slate-600 dark:text-slate-400">{u.unit}</td>
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center px-2 py-1 rounded bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 text-xs font-bold border border-orange-200 dark:border-orange-500/30">
                        <AlertCircle size={14} className="mr-1" /> 缺代理人
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <button className="px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20 rounded-lg text-xs font-bold transition-colors">
                        補齊文件
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= 考勤專屬隨附 Modals 區塊 ================= */}
      <AttendanceImportModal 
        isOpen={isAttendanceImportOpen}
        onClose={() => setIsAttendanceImportOpen(false)}
        selectedProject={selectedProject}
        projectName={projectName || selectedProject}
      />

      <WorkCalendarSettingsModal 
        isOpen={isCalendarSettingsOpen}
        onClose={() => setIsCalendarSettingsOpen(false)}
        selectedProject={selectedProject}
      />

      <AttendanceViewModal 
        isOpen={isAttendanceViewOpen}
        onClose={() => setIsAttendanceViewOpen(false)}
        selectedProject={selectedProject}
        personnel={personnel} 
        allExistingUnits={allExistingUnits}
      />

    </div>
  );
}
