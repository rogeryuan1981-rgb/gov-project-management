import React, { useState, useEffect } from 'react';
import { Calculator, FileText, Users, CheckSquare, Download, Calendar, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { collection, onSnapshot, getFirestore } from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';

const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

export default function ReportsModule({ user, selectedProject }) {
  const [personnel, setPersonnel] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [projectStartDate, setProjectStartDate] = useState('');
  const [projectEndDate, setProjectEndDate] = useState('');
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  const currentYear = new Date().getFullYear();
  const getLocalTodayStr = () => {
    const d = new Date();
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d - tzOffset).toISOString().split('T')[0];
  };

  const [startDate, setStartDate] = useState(`${currentYear}-01-01`);
  const [endDate, setEndDate] = useState(getLocalTodayStr());
  const [message, setMessage] = useState(null); 

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  useEffect(() => {
    if (!user || !selectedProject) return;

    const projectRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'projects');
    const unsubProject = onSnapshot(projectRef, (snapshot) => {
      const currentProj = snapshot.docs.map(d => ({id: d.id, ...d.data()})).find(p => p.id === selectedProject);
      if (currentProj) {
        setProjectName(currentProj.name);
        setProjectStartDate(currentProj.startDate || '');
        setProjectEndDate(currentProj.endDate || '');
      }
    });

    const hrRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'personnel');
    const reqRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'manpower_reqs');
    const tasksRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'tasks');

    const unsubHR = onSnapshot(hrRef, (snapshot) => {
      setPersonnel(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(p => p.projectId === selectedProject));
    });

    const unsubReq = onSnapshot(reqRef, (snapshot) => {
      setRequirements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(r => r.projectId === selectedProject));
    });

    const unsubTasks = onSnapshot(tasksRef, (snapshot) => {
      setTasks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(t => t.projectId === selectedProject));
      setIsDataLoaded(true);
    });

    return () => { unsubProject(); unsubHR(); unsubReq(); unsubTasks(); };
  }, [user, selectedProject]);

  // ================= 報表匯出邏輯 =================

  const exportVacancyReportPDF = () => {
    if (!isDataLoaded) return showMessage('error', '資料載入中，請稍候。');
    if (!startDate || !endDate) return showMessage('error', '請先設定報表區間。');

    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    const projStartMs = projectStartDate ? new Date(projectStartDate).getTime() : 0;

    if (startMs > endMs) return showMessage('error', '開始日期不能晚於結束日期。');

    // 定義排序權重邏輯
    const unitWeights = { '企劃組': 1, '婦幼健康組': 2, '癌症防治組': 3, '專案辦公室': 4 };
    const getUnitWeight = (unit) => unitWeights[unit] || 99;

    const roleWeights = { '專案主任': 1, '專案小組長': 2, '專案專業人員': 3, '專案助理': 4 };
    const getRoleWeight = (role) => roleWeights[role] || 99;

    // 1. 人事異動軌跡
    const activePersonnelChanges = [];
    personnel.forEach(p => {
      const pStart = p.contractStart || p.hireDate;
      const pStartMs = new Date(pStart).getTime();
      let pEndMs = Infinity;
      let exitDateStr = '';
      
      if (p.contractEnd) {
         const d = new Date(p.contractEnd);
         d.setDate(d.getDate() + 1); 
         pEndMs = d.getTime();
         exitDateStr = d.toISOString().split('T')[0];
      }

      if (pStartMs <= endMs && pEndMs >= startMs) {
         const events = [];
         const effectiveStartMs = Math.max(pStartMs, projStartMs);
         const effectiveStartDateStr = new Date(effectiveStartMs).toISOString().split('T')[0];
         
         let initialUnit = p.unit;
         let initialRole = p.role;
         
         if (p.history && p.history.length > 0) {
             for (let i = p.history.length - 1; i >= 0; i--) {
                 const h = p.history[i];
                 const hStartMs = new Date(h.startDate).getTime();
                 if (hStartMs <= effectiveStartMs) {
                     initialUnit = h.unit;
                     initialRole = h.role;
                     break;
                 }
             }
         }
         
         events.push(`${effectiveStartDateStr} 擔任 (${initialUnit}) (${initialRole})`);

         (p.history || []).forEach(h => {
             if (h.startDate) {
                 const hStartMs = new Date(h.startDate).getTime();
                 if (hStartMs > effectiveStartMs && hStartMs <= endMs) {
                     events.push(`${h.startDate} 擔任 (${h.unit}) (${h.role})`);
                 }
             }
         });

         if (p.contractEnd && pEndMs >= startMs && pEndMs <= endMs) {
             events.push(`${exitDateStr} 離職`);
         }

         activePersonnelChanges.push({
             name: p.name,
             unit: initialUnit, 
             role: initialRole, 
             events: events
         });
      }
    });

    activePersonnelChanges.sort((a, b) => {
        const uDiff = getUnitWeight(a.unit) - getUnitWeight(b.unit);
        if (uDiff !== 0) return uDiff;
        return getRoleWeight(a.role) - getRoleWeight(b.role);
    });

    // 2. 各職位人員狀況 (核心改版：拆分獨立員額 Slot)
    const expandedSlots = [];
    
    // 先整理出所有的職位編制
    const sortedRequirements = [...requirements].sort((a, b) => {
        const uDiff = getUnitWeight(a.unit) - getUnitWeight(b.unit);
        if (uDiff !== 0) return uDiff;
        return getRoleWeight(a.position) - getRoleWeight(b.position);
    });

    sortedRequirements.forEach(req => {
        const count = parseInt(req.count, 10) || 1;
        const reqStartMs = req.startDate ? new Date(req.startDate).getTime() : 0;
        const reqEndMs = req.endDate ? new Date(req.endDate).getTime() : Infinity;

        // 只處理與報表區間有交集的編制
        if (reqStartMs > endMs || reqEndMs < startMs) return;

        // 為每個員額建立獨立 Slot
        const slotsForThisReq = Array.from({ length: count }, (_, i) => ({
            unit: req.unit,
            role: req.position,
            slotIndex: i + 1,
            occupants: [],
            vacancies: [] // 儲存此 Slot 的空缺段
        }));

        // 找出屬於此單位職位的人員及其歷程
        const candidatePeriods = [];
        personnel.forEach(p => {
            const pEndMs = p.contractEnd ? new Date(p.contractEnd).getTime() : Infinity;
            (p.history || []).forEach(h => {
                if (h.unit === req.unit && h.role === req.position) {
                    const hStartMs = new Date(h.startDate).getTime();
                    const hEndMs = Math.min(h.endDate ? new Date(h.endDate).getTime() : Infinity, pEndMs);
                    
                    // 歷程需與此編制區間及報表區間都有交集
                    const overlapStart = Math.max(hStartMs, reqStartMs, startMs);
                    const overlapEnd = Math.min(hEndMs, reqEndMs, endMs);

                    if (overlapStart <= overlapEnd) {
                        candidatePeriods.push({
                            name: p.name,
                            startMs: overlapStart,
                            endMs: overlapEnd,
                            startStr: new Date(Math.max(hStartMs, projStartMs)).toISOString().split('T')[0],
                            endStr: h.endDate ? h.endDate : (p.contractEnd ? p.contractEnd : '至今')
                        });
                    }
                }
            });
        });

        // 最優化廠商分配：將人員歷程依時間排序，依序塞入 Slot
        candidatePeriods.sort((a, b) => a.startMs - b.startMs);
        candidatePeriods.forEach(period => {
            // 找尋第一個目前時間點有空的 Slot (或重疊時間最少的)
            let assigned = false;
            for (let slot of slotsForThisReq) {
                const lastOccupant = slot.occupants[slot.occupants.length - 1];
                if (!lastOccupant || lastOccupant.endMs < period.startMs) {
                    slot.occupants.push(period);
                    assigned = true;
                    break;
                }
            }
            // 如果所有 Slot 在此時都滿了（超編情形），則塞入第一個 Slot (稽核通常只看總量是否滿足)
            if (!assigned) slotsForThisReq[0].occupants.push(period);
        });

        // 計算此 Slot 的空缺天數
        slotsForThisReq.forEach(slot => {
            let totalSlotVacancyDays = 0;
            const vacancyPeriods = [];
            
            const checkStart = Math.max(reqStartMs, startMs);
            const checkEnd = Math.min(reqEndMs, endMs);
            
            let currentVacancyStart = null;

            for (let t = checkStart; t <= checkEnd; t += 86400000) {
                const isOccupied = slot.occupants.some(occ => t >= occ.startMs && t <= occ.endMs);
                if (!isOccupied) {
                    totalSlotVacancyDays++;
                    if (!currentVacancyStart) currentVacancyStart = t;
                } else {
                    if (currentVacancyStart) {
                        vacancyPeriods.push({
                            start: new Date(currentVacancyStart).toISOString().split('T')[0],
                            end: new Date(t - 86400000).toISOString().split('T')[0],
                            days: (t - currentVacancyStart) / 86400000
                        });
                        currentVacancyStart = null;
                    }
                }
            }
            if (currentVacancyStart) {
                vacancyPeriods.push({
                    start: new Date(currentVacancyStart).toISOString().split('T')[0],
                    end: new Date(checkEnd).toISOString().split('T')[0],
                    days: (checkEnd - currentVacancyStart + 86400000) / 86400000
                });
            }
            slot.totalVacancyDays = totalSlotVacancyDays;
            slot.vacancyPeriods = vacancyPeriods;
        });

        expandedSlots.push(...slotsForThisReq);
    });

    const printContent = `
      <!DOCTYPE html>
      <html lang="zh-TW">
      <head>
        <meta charset="UTF-8">
        <title>人事異動與空缺紀錄表</title>
        <style>
          body { font-family: 'PingFang TC', 'Microsoft JhengHei', sans-serif; color: #333; line-height: 1.4; padding: 20px; }
          h1 { text-align: center; color: #1e293b; margin-bottom: 5px; }
          h2 { font-size: 18px; color: #4f46e5; border-bottom: 2px solid #e0e7ff; padding-bottom: 5px; margin-top: 30px; }
          .meta { text-align: center; color: #64748b; font-size: 14px; margin-bottom: 30px; }
          table { border-collapse: collapse; margin-bottom: 20px; width: 100%; font-size: 13px; table-layout: fixed; }
          th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; word-wrap: break-word; }
          th { background-color: #f8fafc; color: #475569; font-weight: bold; }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .highlight { color: #ea580c; font-weight: bold; }
          .print-btn { display: block; width: 200px; margin: 20px auto; padding: 10px; background: #4f46e5; color: white; text-align: center; border-radius: 5px; font-weight: bold; cursor: pointer; border:none; }
          @media print { .no-print { display: none !important; } body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="no-print" style="text-align:center; background:#f0fdf4; padding:15px; border-radius:8px;">
          <button class="print-btn" onclick="window.print()">列印 / 儲存為 PDF</button>
        </div>

        <h1>【${projectName}】人事異動與空缺紀錄表</h1>
        <div class="meta">報表區間：${startDate} 至 ${endDate} | 產出日期：${getLocalTodayStr()}</div>

        <h2>一、 期間內人事異動軌跡</h2>
        <table>
          <colgroup><col style="width: 120px;"><col></colgroup>
          <tr><th>姓名</th><th>計劃期間異動軌跡</th></tr>
          ${activePersonnelChanges.map(ap => `
            <tr>
              <td><strong>${ap.name}</strong></td>
              <td>${ap.events.map(e => `<div>${e}</div>`).join('')}</td>
            </tr>
          `).join('')}
        </table>

        <h2>二、 期間內各職位人員在職狀況 (按員額 Slot 拆分)</h2>
        <p style="font-size: 11px; color: #64748b;">說明：依據合規編制員額獨立列示。第一筆紀錄起日取「計畫參與開始日」與「計畫起始日」較晚者。</p>
        <table>
          <colgroup><col style="width:110px;"><col style="width:120px;"><col style="width:90px;"><col></colgroup>
          <tr><th>單位</th><th>職位</th><th>員額編號</th><th>在職人員與期間</th></tr>
          ${expandedSlots.map(slot => `
            <tr>
              <td>${slot.unit}</td>
              <td>${slot.role}</td>
              <td class="text-center">員額 ${slot.slotIndex}</td>
              <td>
                ${slot.occupants.length > 0 
                  ? slot.occupants.map(occ => `<div><strong>${occ.name}</strong> (${occ.startStr} ~ ${occ.endStr})</div>`).join('')
                  : '<span style="color:#94a3b8;">(此員額於期間內全段空缺)</span>'}
              </td>
            </tr>
          `).join('')}
        </table>

        <h2>三、 職位空缺天數精算 (扣款參考)</h2>
        <table>
          <colgroup><col style="width:110px;"><col style="width:110px;"><col style="width:80px;"><col><col style="width:80px;"></colgroup>
          <tr><th>單位</th><th>職位</th><th>員額</th><th>確切空缺日期區間</th><th>小計</th></tr>
          ${expandedSlots.filter(s => s.totalVacancyDays > 0).length === 0 
            ? '<tr><td colspan="5" class="text-center">此期間無任何員額空缺，人力配置完全合規。</td></tr>'
            : expandedSlots.filter(s => s.totalVacancyDays > 0).map(s => `
                <tr>
                  <td rowspan="${Math.max(1, s.vacancyPeriods.length)}">${s.unit}</td>
                  <td rowspan="${Math.max(1, s.vacancyPeriods.length)}">${s.role}</td>
                  <td rowspan="${Math.max(1, s.vacancyPeriods.length)}" class="text-center">員額 ${s.slotIndex}</td>
                  <td>${s.vacancyPeriods[0]?.start} ~ ${s.vacancyPeriods[0]?.end}</td>
                  <td class="text-right highlight">${s.vacancyPeriods[0]?.days} 天</td>
                </tr>
                ${s.vacancyPeriods.slice(1).map(vp => `
                  <tr>
                    <td>${vp.start} ~ ${vp.end}</td>
                    <td class="text-right highlight">${vp.days} 天</td>
                  </tr>
                `).join('')}
              `).join('')
          }
          <tr style="background:#f8fafc; font-weight:bold;">
            <td colspan="4" class="text-right">總計空缺人天：</td>
            <td class="text-right" style="font-size:16px; color:#ef4444;">${expandedSlots.reduce((acc, s) => acc + s.totalVacancyDays, 0)} 人天</td>
          </tr>
        </table>
        
        <div style="margin-top: 40px; display: flex; justify-content: space-between; padding: 0 40px;">
          <div>承辦人：<br/><br/><br/>________________</div>
          <div>計畫主持人：<br/><br/><br/>________________</div>
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '', 'width=1000,height=800');
    printWindow.document.write(printContent);
    printWindow.document.close();
    setTimeout(() => printWindow.focus(), 500);
    showMessage('success', '✅ 異動與空缺紀錄表已產出。');
  };

  const exportAttendanceCSV = () => {
    if (!isDataLoaded) return showMessage('error', '資料載入中。');
    const csvRows = ['\uFEFF姓名,所屬單位,職位,駐點身分,在職狀態,計畫起日,計畫迄日,代理異常'];
    personnel.forEach(p => {
      const isResidentStr = p.isResident ? '駐點' : '非駐點';
      const statusStr = p.contractEnd && p.contractEnd < getLocalTodayStr() ? '已離職' : '在職';
      const proxyStr = p.proxyAlert ? '異常' : '合規';
      csvRows.push(`"${p.name}","${p.unit}","${p.role}",${isResidentStr},${statusStr},${p.contractStart || p.hireDate},${p.contractEnd || '至今'},${proxyStr}`);
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csvRows.join('\n')], { type: "text/csv;charset=utf-8;" }));
    link.download = `考勤匯總_${projectName}_${startDate}.csv`;
    link.click();
  };

  const exportProgressWord = () => {
    if (!isDataLoaded) return;
    const completedTasks = tasks.filter(t => t.status === 'completed' && t.due >= startDate && t.due <= endDate);
    const htmlContent = `<html><body style="font-family:SimSun;"><h1>${projectName} 成果報告初稿</h1><table border="1"><tr><th>工項</th><th>負責人</th><th>完成日</th></tr>${completedTasks.map(t => `<tr><td>${t.title}</td><td>${t.assignee}</td><td>${t.due}</td></tr>`).join('')}</table></body></html>`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['\ufeff', htmlContent], { type: 'application/msword' }));
    link.download = `成果初稿_${projectName}.doc`;
    link.click();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-300">
      {message && (
        <div className={`p-4 rounded-xl border flex items-start shadow-sm animate-in slide-in-from-top-2 ${
          message.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
        }`}>
          {message.type === 'error' ? <AlertCircle size={20} className="mr-3 shrink-0 mt-0.5" /> : <CheckCircle2 size={20} className="mr-3 shrink-0 mt-0.5" />}
          <span className="text-sm font-bold">{message.text}</span>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center">
            <Calculator className="mr-3 text-indigo-500" size={24} />核銷作業報表中心
          </h2>
          <p className="text-sm text-slate-500 mt-2">設定日期區間後，產出符合政府稽核標準之員額異動與空缺精算表。</p>
        </div>
        
        <div className="flex items-center space-x-3 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 transition-colors">
          <Calendar className="text-slate-400" size={18} />
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-700 dark:text-slate-200 outline-none" />
          <span className="text-slate-400 font-bold">至</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-700 dark:text-slate-200 outline-none" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm flex flex-col group hover:border-indigo-300 transition-colors">
          <div className="p-4 bg-blue-50 dark:bg-blue-500/10 rounded-2xl w-fit mb-5"><FileText className="text-blue-600" size={28} /></div>
          <h3 className="text-lg font-bold mb-2">1. 人員考勤匯總表</h3>
          <p className="text-sm text-slate-500 flex-1 mb-8">匯出含考勤、假別與規政代理狀態之 Excel，用於月結核銷。</p>
          <button onClick={exportAttendanceCSV} disabled={!isDataLoaded} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm flex justify-center items-center space-x-2">
            {isDataLoaded ? <Download size={16} /> : <Loader2 size={16} className="animate-spin" />}<span>匯出 CSV</span>
          </button>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-orange-200 dark:border-orange-500/30 shadow-sm flex flex-col group hover:border-orange-400 transition-colors relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-orange-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl shadow-sm">核心稽核</div>
          <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 rounded-2xl w-fit mb-5"><Users className="text-emerald-600" size={28} /></div>
          <h3 className="text-lg font-bold mb-2">2. 異動與空缺紀錄表</h3>
          <p className="text-sm text-slate-500 flex-1 mb-8">按員額員額 Slot 獨立精算在職與空缺區間，作為扣款依據之正式附件。</p>
          <button onClick={exportVacancyReportPDF} disabled={!isDataLoaded} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm flex justify-center items-center space-x-2">
            {isDataLoaded ? <Download size={16} /> : <Loader2 size={16} className="animate-spin" />}<span>匯出 PDF (精算版)</span>
          </button>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm flex flex-col group hover:border-amber-300 transition-colors">
          <div className="p-4 bg-amber-50 dark:bg-amber-500/10 rounded-2xl w-fit mb-5"><CheckSquare className="text-amber-600" size={28} /></div>
          <h3 className="text-lg font-bold mb-2">3. 期中/期末成果初稿</h3>
          <p className="text-sm text-slate-500 flex-1 mb-8">擷取區間內已結案之工項進度，快速產出報告文字初稿。</p>
          <button onClick={exportProgressWord} disabled={!isDataLoaded} className="w-full py-3 border-2 border-indigo-100 dark:border-indigo-500/30 text-indigo-600 font-bold rounded-xl transition-all hover:bg-indigo-50 flex justify-center items-center space-x-2">
            {isDataLoaded ? <Download size={16} /> : <Loader2 size={16} className="animate-spin" />}<span>產出 Word 初稿</span>
          </button>
        </div>
      </div>
    </div>
  );
}
