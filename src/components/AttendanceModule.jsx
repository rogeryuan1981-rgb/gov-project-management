import React, { useState, useEffect } from 'react';
import { Clock, Upload, CalendarDays, ShieldAlert, AlertCircle, ChevronRight, CheckCircle2, Sliders, ToggleLeft, ToggleRight, Check, X, UserCheck, Save, Calendar } from 'lucide-react';
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

  // 💡 修正2：將防呆設定面板改為另開視窗控制狀態，平常內縮隱藏
  const [isProxySettingsModalOpen, setIsProxySettingsModalOpen] = useState(false);
  
  // 💡 修正1：控制點選「代理異常卡片」後彈出的明細與派代維護大視窗
  const [isProxyExceptionDetailsOpen, setIsProxyExceptionDetailsOpen] = useState(false);

  // 代理篩選規則狀態定義
  const [proxyThresholdDays, setProxyThresholdDays] = useState(2); 
  const [includeHolidays, setIncludeHolidays] = useState(false); 
  const [monthlyThresholdDays, setMonthlyThresholdDays] = useState(5); 
  const [exemptLeaveTypes, setExemptLeaveTypes] = useState(['特休', '補休']);
  const ALL_LEAVE_TYPES = ['特休', '事假', '病假', '喪假', '公出', '補休'];

  // 控制特定派代明細列的手動表單展開狀態
  const [assigningId, setAssigningId] = useState(null);
  const [assignForm, setAssignForm] = useState({ proxyName: '', startHour: '08:30', endHour: '17:30' });

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

  // =========================================================================
  // 🧠 核心代理合規異常分析引擎 (回傳全量受罰明細與累計小時數)
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
        const hasProxy = record ? !!(record.proxyName || record.proxyNameField) : false;

        if (isOffDay) {
          if (includeHolidays) {
            // 假日不切斷連續請假鏈條
          } else {
            continuousLeaveChain = 0;
          }
          continue;
        }

        if (leaveType) {
          monthlyLeaveCount++;
          continuousLeaveChain++;

          const needProxyByContinuous = continuousLeaveChain > proxyThresholdDays;
          const needProxyByMonthly = monthlyLeaveCount > monthlyThresholdDays;

          if (needProxyByContinuous || needProxyByMonthly) {
            const isExemptToday = exemptLeaveTypes.includes(leaveType);
            
            if (!isExemptToday) {
              if (!hasProxy) {
                exceptionHours += 8;
                
                // 智慧封裝：抓取或自動兜底生成該筆紀錄在資料庫的文件標記
                const realDocId = record?.id || `${selectedProject}_${person.name}_${dateStr}`;
                
                exceptionDetailsList.push({
                  uniqueId: `proxy_exc_${person.name}_${dateStr}`,
                  realDocId: realDocId,
                  name: person.name,
                  unit: person.unit || '未指定單位',
                  date: dateStr,
                  leaveType: leaveType,
                  leaveRangeInfo: record?.leaveRangeInfo || '全天差假',
                  triggerReason: needProxyByContinuous && needProxyByMonthly 
                    ? `連續請假超標 (${continuousLeaveChain}天) 且 當月累計超標 (${monthlyLeaveCount}天)` 
                    : (needProxyByContinuous ? `連續請假達 ${continuousLeaveChain} 天已過門檻` : `當月累計請假達 ${monthlyLeaveCount} 天已過門檻`)
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

  // 💡 實時手動填寫代理人與時間區間，同步回寫 Firebase
  const handleSaveProxyAssignment = async (item) => {
    if (!assignForm.proxyName.trim()) { alert("請填寫代理人姓名！"); return; }
    try {
      const attRecordsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'attendance_records');
      const docRef = doc(attRecordsRef, item.realDocId);
      
      // 讀取舊有數據進行 merge 寫入
      const docSnap = await getDoc(docRef);
      const baseData = docSnap.exists() ? docSnap.data() : {};

      const updatedProxyData = {
        ...baseData,
        projectId: selectedProject,
        month: todayYearMonth,
        name: item.name,
        date: item.date,
        leaveType: item.leaveType,
        leaveRangeInfo: `${assignForm.startHour}~${assignForm.endHour}`, // 手動指派代理區間起迄
        proxyName: assignForm.proxyName.trim(), // 綁定代理同仁
        isManualMaintained: true, // 特赦令同步啟用
        updatedAt: new Date().getTime()
      };

      await setDoc(docRef, updatedProxyData, { merge: true });
      setAssigningId(null);
      setAssignForm({ proxyName: '', startHour: '08:30', endHour: '17:30' });
      alert(`✅ 成功為 ${item.name} 排定代理人【${updatedProxyData.proxyName}】！`);
    } catch (e) {
      console.error(e);
      alert("指派代理人失敗，請檢查網路連線。");
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* 💡 修正1：連續擴充點選機制，當大於 0 小時才可點選 */}
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
              <span className="text-xs font-bold">點擊指派代理</span>
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

        {/* 💡 修正2：防呆門檻控制平常完全內縮，與工作日曆完全對齊的按鈕點選形式開窗 */}
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
          💡 全新視窗化：1. 代理異常案件明細與手動派代維護大視窗
         ========================================================================= */}
      {isProxyExceptionDetailsOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 w-full max-w-4xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
              <div>
                <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center"><ShieldAlert size={20} className="mr-2 text-orange-500" />特定假別代理異常案件審查中心</h3>
                <p className="text-xs text-slate-400 mt-0.5">目前月份共追蹤出 {proxyExceptionList.length} 筆不合規請假列。您可就地填寫代理時段起迄與人名以消滅受罰小時數。</p>
              </div>
              <button onClick={() => { setIsProxyExceptionDetailsOpen(false); setAssigningId(null); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors"><X size={20} /></button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-900/20">
              <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm bg-white dark:bg-slate-800">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-500">
                    <tr>
                      <th className="py-3 px-4" style={{width: '95px'}}>請假日期</th>
                      <th className="py-3 px-4" style={{width: '120px'}}>姓名/組別</th>
                      <th className="py-3 px-4" style={{width: '85px'}}>假別屬性</th>
                      <th className="py-3 px-4">系統超標追蹤判定原因</th>
                      <th className="py-3 px-4 text-right" style={{width: '180px'}}>核心手動派代作業</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 text-slate-700 dark:text-slate-200 font-medium">
                    {proxyExceptionList.map(item => {
                      const isAssigning = assigningId === item.uniqueId;
                      return (
                        <tr key={item.uniqueId} className={`hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors ${isAssigning ? 'bg-indigo-50/40 dark:bg-indigo-950/20' : ''}`}>
                          <td className="py-3 px-4 font-bold font-mono text-slate-900 dark:text-slate-100">{item.date}</td>
                          <td className="py-3 px-4">
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-900 dark:text-slate-100">{item.name}</span>
                              <span className="text-[10px] text-slate-400 font-semibold">{item.unit}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4"><span className="px-2 py-0.5 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 rounded-md font-bold border border-red-100 dark:border-red-500/20">{item.leaveType}</span></td>
                          <td className="py-3 px-4 text-slate-500 dark:text-slate-400 leading-relaxed">{item.triggerReason}</td>
                          <td className="py-3 px-4 text-right">
                            {isAssigning ? (
                              <div className="space-y-2 p-2 bg-white dark:bg-slate-900 border rounded-xl shadow-inner text-left animate-in fade-in duration-200">
                                <div>
                                  <label className="block text-[9px] font-bold text-slate-400 mb-0.5">代理人姓名 *</label>
                                  <input type="text" value={assignForm.proxyName} onChange={e => setAssignForm({...assignForm, proxyName: e.target.value})} placeholder="請輸入同仁姓名" className="w-full px-2 py-1 bg-slate-50 dark:bg-slate-800 border rounded text-xs outline-none text-slate-800 dark:text-white" />
                                </div>
                                <div className="grid grid-cols-2 gap-1.5">
                                  <div>
                                    <label className="block text-[9px] font-bold text-slate-400 mb-0.5">代理時間(起)</label>
                                    <input type="text" value={assignForm.startHour} onChange={e => setAssignForm({...assignForm, startHour: e.target.value})} className="w-full px-1.5 py-0.5 bg-slate-50 dark:bg-slate-800 border rounded text-[11px] font-mono text-center" />
                                  </div>
                                  <div>
                                    <label className="block text-[9px] font-bold text-slate-400 mb-0.5">代理時間(迄)</label>
                                    <input type="text" value={assignForm.endHour} onChange={e => setAssignForm({...assignForm, endHour: e.target.value})} className="w-full px-1.5 py-0.5 bg-slate-50 dark:bg-slate-800 border rounded text-[11px] font-mono text-center" />
                                  </div>
                                </div>
                                <div className="flex justify-end space-x-1.5 pt-1 border-t">
                                  <button type="button" onClick={() => setAssigningId(null)} className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded text-[10px]">取消</button>
                                  <button type="button" onClick={() => handleSaveProxyAssignment(item)} className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded text-[10px] flex items-center shadow-xs"><Save size={10} className="mr-1" />儲存排代</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" onClick={() => { setAssigningId(item.uniqueId); setAssignForm({ proxyName: '', startHour: '08:30', endHour: '17:30' }); }} className="px-2.5 py-1.5 border border-slate-200 hover:border-indigo-400 text-indigo-600 dark:text-indigo-400 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-500/10 font-bold transition-all inline-flex items-center"><UserCheck size={12} className="mr-1" />手動指派代理</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex justify-end"><button onClick={() => { setIsProxyExceptionDetailsOpen(false); setAssigningId(null); }} className="px-6 py-2 bg-slate-200 text-slate-700 hover:bg-slate-300 font-bold rounded-xl text-xs">關閉審查視窗</button></div>
          </div>
        </div>
      )}

      {/* =========================================================================
          💡 修正2：另開高質感專屬彈窗視窗「規政代理與合規防呆設定視窗」，平常保持內縮
         ========================================================================= */}
      {isProxySettingsModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400"><Sliders size={18} /></div>
                <div>
                  <h3 className="font-bold text-base text-slate-800 dark:text-white">規政代理與合規門檻防呆設定</h3>
                  <p className="text-xs text-slate-400 mt-0.5">獨立管理本計畫之請假天數防呆限制門檻。</p>
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
                  4. 免除代理假別設定 (💡 當天免代理，但仍須併入上述連續及累計天數計算)
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
