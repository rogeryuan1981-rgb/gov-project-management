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

  // ================= 報表核心邏輯：日期定錨演算法 =================

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

    // 1. 人事異動軌跡 (核心修正：嚴格過濾並定錨日期)
    const activePersonnelChanges = [];
    personnel.forEach(p => {
      const pOnboardMs = p.hireDate ? new Date(p.hireDate).getTime() : 0;
      
      // 過濾並定錨該員在此計畫中的有效歷程
      const validHistory = (p.history || []).filter(h => {
          if (!h.unit || !h.role || !h.startDate) return false;
          const hStartMs = new Date(h.startDate).getTime();
          // 計算該段歷程的實際有效終點：若歷程無終點，取人員離職日；若人員沒離職，無限大
          const hEndMs = h.endDate ? new Date(h.endDate).getTime() : (p.contractEnd ? new Date(p.contractEnd).getTime() : Infinity);
          // 歷程必須與計畫區間有交集，且不能完全發生在計畫起始日之前
          return hEndMs >= projStartMs && hStartMs <= endMs;
      }).sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

      if (validHistory.length > 0) {
         const events = [];
         
         validHistory.forEach((h, idx) => {
             const hStartMs = new Date(h.startDate).getTime();
             // 第一筆異動顯示邏輯
             if (idx === 0) {
                 // 關鍵定錨：參與計畫開始日 = Max(職務就任日, 個人到職日, 計畫起始日)
                 const effectiveStartMs = Math.max(hStartMs, pOnboardMs, projStartMs);
                 const displayStr = new Date(effectiveStartMs).toISOString().split('T')[0];
                 events.push(`${displayStr} 擔任 (${h.unit}) (${h.role})`);
             } else {
                 // 後續轉任：直接顯示實際轉任日
                 events.push(`${h.startDate} 擔任 (${h.unit}) (${h.role})`);
             }
         });

         // 離職事件 (退出計畫日為最後工作日之隔日)
         if (p.contractEnd) {
             const exitD = new Date(p.contractEnd);
             exitD.setDate(exitD.getDate() + 1);
             const exitMs = exitD.getTime();
             if (exitMs >= startMs && exitMs <= endMs) {
                 events.push(`${exitD.toISOString().split('T')[0]} 離職`);
             }
         }

         activePersonnelChanges.push({
             name: p.name,
             unit: validHistory[0].unit, 
             role: validHistory[0].role, 
             events: events
         });
      }
    });

    activePersonnelChanges.sort((a, b) => {
        const uDiff = getUnitWeight(a.unit) - getUnitWeight(b.unit);
        if (uDiff !== 0) return uDiff;
        return getRoleWeight(a.role) - getRoleWeight(b.role);
    });

    // 2. 彙整合併職缺群組與 Slot 分配 (核心修正：定錨參與日期)
    const roleGroups = {};
    requirements.forEach(req => {
        const key = `${req.unit}::${req.position}`;
        if (!roleGroups[key]) {
            roleGroups[key] = { unit: req.unit, role: req.position, reqs: [], segments: [] };
        }
        roleGroups[key].reqs.push({
            count: parseInt(req.count, 10) || 1,
            sMs: req.startDate ? new Date(req.startDate).getTime() : 0,
            eMs: req.endDate ? new Date(req.endDate).getTime() : Infinity,
            pMs: req.penaltyStartDate ? new Date(req.penaltyStartDate).getTime() : (req.startDate ? new Date(req.startDate).getTime() : 0)
        });
    });

    personnel.forEach(p => {
        const pOnboardMs = p.hireDate ? new Date(p.hireDate).getTime() : 0;
        const pEndMs = p.contractEnd ? new Date(p.contractEnd).getTime() : Infinity;
        (p.history || []).forEach(h => {
            if (!h.unit || !h.role) return;
            const key = `${h.unit}::${h.role}`;
            if (roleGroups[key]) {
                const hStartMs = new Date(h.startDate).getTime();
                const hEndMs = Math.min(h.endDate ? new Date(h.endDate).getTime() : Infinity, pEndMs);
                
                // 定錨參與日：該員在此職務上對計畫有效的起始日
                const effectiveStartMs = Math.max(hStartMs, pOnboardMs, projStartMs);
                
                if (effectiveStartMs <= hEndMs && effectiveStartMs <= endMs) {
                    roleGroups[key].segments.push({
                        name: p.name,
                        startMs: effectiveStartMs,
                        endMs: hEndMs,
                        startStr: new Date(effectiveStartMs).toISOString().split('T')[0],
                        endStr: h.endDate ? h.endDate : (p.contractEnd ? p.contractEnd : '至今')
                    });
                }
            }
        });
    });

    const expandedSlots = [];
    const vacancyTables = [];

    Object.values(roleGroups)
      .sort((a, b) => {
          const uDiff = getUnitWeight(a.unit) - getUnitWeight(b.unit);
          if (uDiff !== 0) return uDiff;
          return getRoleWeight(a.role) - getRoleWeight(b.role);
      })
      .forEach(group => {
        let maxReqCount = 0;
        const groupStartLimitMs = Math.max(startMs, Math.min(...group.reqs.map(r => r.sMs)));
        const groupEndLimitMs = Math.min(endMs, Math.max(...group.reqs.map(r => r.eMs)));
        
        if (groupStartLimitMs > groupEndLimitMs) return;

        for (let t = groupStartLimitMs; t <= groupEndLimitMs; t += 86400000) {
            let dReq = 0; group.reqs.forEach(r => { if (t >= r.sMs && t <= r.eMs) dReq += r.count; });
            maxReqCount = Math.max(maxReqCount, dReq);
        }

        const slots = Array.from({length: maxReqCount}, (_, i) => ({
            unit: group.unit, role: group.role, slotIndex: i + 1, label: `員額 ${i + 1}`, occupants: []
        }));
        const overstaffSlots = [];

        group.segments.sort((a, b) => a.startMs - b.startMs).forEach(seg => {
            let assigned = false;
            for (let slot of slots) {
                const last = slot.occupants[slot.occupants.length - 1];
                if (!last || last.endMs < seg.startMs) {
                    slot.occupants.push(seg); assigned = true; break;
                }
            }
            if (!assigned) {
                for (let slot of overstaffSlots) {
                    const last = slot.occupants[slot.occupants.length - 1];
                    if (!last || last.endMs < seg.startMs) {
                        slot.occupants.push(seg); assigned = true; break;
                    }
                }
                if (!assigned) overstaffSlots.push({ unit: group.unit, role: group.role, slotIndex: 99, label: '(超編員額)', occupants: [seg] });
            }
        });

        // 為每個 Slot 注入空缺(紅字)標記
        [...slots, ...overstaffSlots].forEach(slot => {
            const finalTimeline = [];
            let currentTime = groupStartLimitMs;
            
            // 排序該員額的佔用者
            const sortedOccs = [...slot.occupants].sort((a, b) => a.startMs - b.startMs);
            
            sortedOccs.forEach(occ => {
                // 如果目前時間點到下一個人員到職之間有空隙，且該 Slot 此時是有需求的
                if (occ.startMs > currentTime) {
                    const vStart = currentTime;
                    const vEnd = occ.startMs - 86400000;
                    if (vStart <= vEnd) {
                        finalTimeline.push({ isVacancy: true, startStr: new Date(vStart).toISOString().split('T')[0], endStr: new Date(vEnd).toISOString().split('T')[0] });
                    }
                }
                finalTimeline.push({ isVacancy: false, name: occ.name, startStr: occ.startStr, endStr: occ.endStr });
                currentTime = occ.endMs + 86400000;
            });

            // 處理最後一段空缺 (到報表或編制結束)
            if (currentTime <= groupEndLimitMs && slot.slotIndex !== 99) {
                finalTimeline.push({ isVacancy: true, startStr: new Date(currentTime).toISOString().split('T')[0], endStr: new Date(groupEndLimitMs).toISOString().split('T')[0] });
            }
            slot.timeline = finalTimeline;
        });

        expandedSlots.push(...slots, ...overstaffSlots);

        // ================= 3. 空缺天數精算 (彙整報表) =================
        let currentVacancy = null; const vacancyPeriods = [];
        let totalPenaltyDays = 0; let totalGraceDays = 0;

        for (let t = groupStartLimitMs; t <= groupEndLimitMs; t += 86400000) {
            let dailyReq = 0; let dailyPenaltyReq = 0;
            group.reqs.forEach(r => {
                if (t >= r.sMs && t <= r.eMs) {
                    dailyReq += r.count;
                    if (t >= r.pMs) dailyPenaltyReq += r.count;
                }
            });
            if (dailyReq === 0) {
                if (currentVacancy) { vacancyPeriods.push(currentVacancy); currentVacancy = null; }
                continue;
            }
            let activeCount = 0; group.segments.forEach(seg => { if (t >= seg.startMs && t <= seg.endMs) activeCount++; });
            const missing = Math.max(0, dailyReq - activeCount);
            const penaltyMissing = Math.max(0, dailyPenaltyReq - activeCount);
            const graceMissing = missing - penaltyMissing;

            if (missing > 0) {
                totalPenaltyDays += penaltyMissing; totalGraceDays += graceMissing;
                const dStr = new Date(t).toISOString().split('T')[0];
                if (!currentVacancy) currentVacancy = { start: dStr, end: dStr, missing, penaltyMissing, graceMissing, days: 1 };
                else if (currentVacancy.missing === missing && currentVacancy.penaltyMissing === penaltyMissing) { currentVacancy.end = dStr; currentVacancy.days++; }
                else { vacancyPeriods.push(currentVacancy); currentVacancy = { start: dStr, end: dStr, missing, penaltyMissing, graceMissing, days: 1 }; }
            } else { if (currentVacancy) { vacancyPeriods.push(currentVacancy); currentVacancy = null; } }
        }
        if (currentVacancy) vacancyPeriods.push(currentVacancy);
        if (vacancyPeriods.length > 0) {
            vacancyTables.push({ unit: group.unit, role: group.role, maxReq: maxReqCount, periods: vacancyPeriods, totalPenaltyDays, totalGraceDays });
        }
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
          .highlight { color: #ef4444; font-weight: bold; }
          .grace { color: #10b981; font-weight: bold; }
          .print-btn { display: block; width: 200px; margin: 20px auto; padding: 10px; background: #4f46e5; color: white; text-align: center; border-radius: 5px; font-weight: bold; cursor: pointer; border:none; }
          @media print { .no-print { display: none !important; } body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="no-print" style="text-align:center; background:#f0fdf4; padding:15px; border-radius:8px;">
          <button class="print-btn" onclick="window.print()">列印 / 儲存為 PDF</button>
        </div>

        <h1>【${projectName}】人事異動與空缺紀錄表</h1>
        <div class="meta">報表統計區間：${startDate} 至 ${endDate} | 產出日期：${getLocalTodayStr()}</div>

        <h2>一、 期間內人事異動軌跡</h2>
        <p style="font-size: 11px; color: #64748b;">說明：參與計畫起始日取「實際就任日」與「計畫起日 (${projectStartDate})」之較晚者。退出日為最後工作日之隔日。</p>
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
        <table>
          <colgroup><col style="width:110px;"><col style="width:120px;"><col style="width:90px;"><col></colgroup>
          <tr><th>單位</th><th>職位</th><th>員額編號</th><th>在職人員與期間 (含空缺標記)</th></tr>
          ${expandedSlots.map(slot => `
            <tr>
              <td>${slot.unit}</td>
              <td>${slot.role}</td>
              <td class="text-center">${slot.label}</td>
              <td>
                ${slot.timeline.map(item => 
                  item.isVacancy 
                  ? `<div class="highlight">空缺 (${item.startStr} ~ ${item.endStr})</div>`
                  : `<div><strong>${item.name}</strong> (${item.startStr} ~ ${item.endStr})</div>`
                ).join('')}
                ${slot.timeline.length === 0 ? '<span style="color:#94a3b8;">(此員額於期間內全段空缺)</span>' : ''}
              </td>
            </tr>
          `).join('')}
        </table>

        <h2>三、 職位空缺天數精算 (合併精算與違約判定)</h2>
        <table>
          <colgroup><col style="width:110px;"><col style="width:110px;"><col style="width:70px;"><col><col style="width:80px;"><col style="width:80px;"></colgroup>
          <tr><th>單位</th><th>職位</th><th class="text-center">編制</th><th>確切空缺日期區間 (合併計算)</th><th class="text-right">違約空窗<br/>(人天)</th><th class="text-right">免罰寬限<br/>(人天)</th></tr>
          ${vacancyTables.length === 0 
            ? '<tr><td colspan="6" class="text-center">此期間無任何人力空窗，配置完全合規。</td></tr>'
            : vacancyTables.map(vt => `
                <tr>
                  <td rowspan="${vt.periods.length}">${vt.unit}</td>
                  <td rowspan="${vt.periods.length}">${vt.role}</td>
                  <td rowspan="${vt.periods.length}" class="text-center">${vt.maxReq} 人</td>
                  <td>${vt.periods[0].start} ~ ${vt.periods[0].end} <span style="font-size:10px; color:#64748b;">(少 ${vt.periods[0].missing}人)</span></td>
                  <td class="text-right highlight">${vt.periods[0].penaltyMissing * vt.periods[0].days > 0 ? vt.periods[0].penaltyMissing * vt.periods[0].days : '-'}</td>
                  <td class="text-right grace">${vt.periods[0].graceMissing * vt.periods[0].days > 0 ? vt.periods[0].graceMissing * vt.periods[0].days : '-'}</td>
                </tr>
                ${vt.periods.slice(1).map(vp => `
                  <tr>
                    <td>${vp.start} ~ ${vp.end} <span style="font-size:10px; color:#64748b;">(少 ${vp.missing}人)</span></td>
                    <td class="text-right highlight">${vp.penaltyMissing * vp.days > 0 ? vp.penaltyMissing * vp.days : '-'}</td>
                    <td class="text-right grace">${vp.graceMissing * vp.days > 0 ? vp.graceMissing * vp.days : '-'}</td>
                  </tr>
                `).join('')}
              `).join('')
          }
          <tr style="background:#f8fafc; font-weight:bold;">
            <td colspan="4" class="text-right">累計加總：</td>
            <td class="text-right highlight" style="font-size:15px;">${vacancyTables.reduce((acc, vt) => acc + vt.totalPenaltyDays, 0)}</td>
            <td class="text-right grace" style="font-size:15px;">${vacancyTables.reduce((acc, vt) => acc + vt.totalGraceDays, 0)}</td>
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
