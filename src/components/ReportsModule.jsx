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
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  // 取得今年初到今天的預設區間
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

  // 監聽所有報表需要的資料
  useEffect(() => {
    if (!user || !selectedProject) return;

    // 取得專案名稱與專案起始日
    const projectRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'projects');
    const unsubProject = onSnapshot(projectRef, (snapshot) => {
      const currentProj = snapshot.docs.map(d => ({id: d.id, ...d.data()})).find(p => p.id === selectedProject);
      if (currentProj) {
        setProjectName(currentProj.name);
        if (currentProj.startDate) setProjectStartDate(currentProj.startDate);
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

  // ================= 匯出 1：考勤匯總表 (CSV) =================
  const exportAttendanceCSV = () => {
    if (!isDataLoaded) return showMessage('error', '資料載入中，請稍候。');
    if (!startDate || !endDate) return showMessage('error', '請先設定報表區間。');

    const csvRows = ['\uFEFF姓名,所屬單位,職位,駐點身分,在職狀態,參與計畫起日,參與計畫迄日,規政代理異常狀態'];
    
    personnel.forEach(p => {
      const isResidentStr = p.isResident ? '駐點' : '非駐點';
      const statusStr = p.contractEnd && p.contractEnd < getLocalTodayStr() ? '已離職' : '在職';
      const proxyStr = p.proxyAlert ? '異常 (缺代理人)' : '合規';
      csvRows.push(`"${p.name}","${p.unit}","${p.role}",${isResidentStr},${statusStr},${p.contractStart || p.hireDate},${p.contractEnd || '至今'},${proxyStr}`);
    });

    const blob = new Blob([csvRows.join('\n')], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `人員考勤與代理匯總表_${projectName}_${startDate}至${endDate}.csv`;
    link.click();
    showMessage('success', '✅ 考勤匯總表 (CSV) 已成功下載！');
  };

  // ================= 匯出 2：期中期末初稿 (HTML 轉 Word) =================
  const exportProgressWord = () => {
    if (!isDataLoaded) return showMessage('error', '資料載入中，請稍候。');
    
    const completedTasks = tasks.filter(t => t.status === 'completed' && t.due >= startDate && t.due <= endDate);
    
    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset="utf-8"><title>成果報告初稿</title></head>
      <body style="font-family: '微軟正黑體', sans-serif;">
        <h1 style="text-align: center;">【${projectName}】專案進度與成果報告初稿</h1>
        <p style="text-align: center;">彙整期間：${startDate} 至 ${endDate}</p>
        <hr />
        <h2>一、 期間內已結案工項清單</h2>
        <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%;">
          <tr style="background-color: #f2f2f2;"><th>工項名稱</th><th>負責人</th><th>完成日期</th><th>最終進度說明</th></tr>
          ${completedTasks.map(t => `<tr><td>${t.title}</td><td>${t.assignee}</td><td>${t.due}</td><td>${t.currentProgress || '-'}</td></tr>`).join('')}
          ${completedTasks.length === 0 ? '<tr><td colSpan="4" style="text-align:center;">此期間無結案工項</td></tr>' : ''}
        </table>
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `成果初稿_${projectName}_${startDate}至${endDate}.doc`;
    link.click();
    showMessage('success', '✅ 成果報告初稿 (Word) 已成功下載！');
  };

  // ================= 匯出 3：異動與空缺紀錄表 (Print PDF) =================
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

    // 1. 撈取區間內的人事異動軌跡
    const activePersonnelChanges = [];
    
    personnel.forEach(p => {
      // 強制防呆：任何生效日不可早於實際 hireDate
      const hireDateMs = new Date(p.hireDate).getTime();
      const contractStartMs = new Date(p.contractStart || p.hireDate).getTime();
      const pStartMs = Math.max(hireDateMs, contractStartMs);
      
      let pEndMs = Infinity;
      let exitDateStr = '';
      
      // 計算實際離職日：政府機關規定為最後工作日(contractEnd)的隔日
      if (p.contractEnd) {
         const d = new Date(p.contractEnd);
         d.setDate(d.getDate() + 1); // 隔日
         pEndMs = d.getTime();
         exitDateStr = d.toISOString().split('T')[0];
      }

      // 若該人員在此區間內曾有在職紀錄
      if (pStartMs <= endMs && pEndMs >= startMs) {
         const events = [];
         
         // 取「計畫參與開始日」與「計畫起始日」較晚者
         const effectiveStartMs = Math.max(pStartMs, projStartMs);
         const effectiveStartDateStr = new Date(effectiveStartMs).toISOString().split('T')[0];
         
         // 尋找在該「生效日」時擔任的單位與職位
         let initialUnit = p.unit;
         let initialRole = p.role;
         
         if (p.history && p.history.length > 0) {
             for (let i = p.history.length - 1; i >= 0; i--) {
                 const h = p.history[i];
                 let hStartMs = new Date(h.startDate).getTime();
                 hStartMs = Math.max(hStartMs, hireDateMs); // 強制防呆
                 if (hStartMs <= effectiveStartMs) {
                     initialUnit = h.unit;
                     initialRole = h.role;
                     break;
                 }
             }
         }
         
         events.push(`${effectiveStartDateStr} 擔任 (${initialUnit}) (${initialRole})`);

         // 後續職務轉任事件 (必須發生在生效日之後、且在報表結束日之前)
         (p.history || []).forEach(h => {
             if (h.startDate) {
                 let hStartMs = new Date(h.startDate).getTime();
                 hStartMs = Math.max(hStartMs, hireDateMs);
                 if (hStartMs > effectiveStartMs && hStartMs <= endMs) {
                     const dateStr = new Date(hStartMs).toISOString().split('T')[0];
                     events.push(`${dateStr} 擔任 (${h.unit}) (${h.role})`);
                 }
             }
         });

         // 離職事件
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

    // 依據單位與職位排序人員 (軌跡表)
    activePersonnelChanges.sort((a, b) => {
        const uDiff = getUnitWeight(a.unit) - getUnitWeight(b.unit);
        if (uDiff !== 0) return uDiff;
        return getRoleWeight(a.role) - getRoleWeight(b.role);
    });

    // 產生異動軌跡的 HTML Rows
    let changeRecordsHtml = '';
    if (activePersonnelChanges.length === 0) {
      changeRecordsHtml = '<tr><td colspan="2" class="text-center" style="color:#94a3b8;">此區間內無任何人員在職紀錄</td></tr>';
    } else {
      activePersonnelChanges.forEach(ap => {
        const eventsHtml = ap.events.map(e => `<div style="margin-bottom: 4px;">${e}</div>`).join('');
        changeRecordsHtml += `
          <tr>
            <td style="vertical-align: top; width: 150px; font-weight: bold;">${ap.name}</td>
            <td style="vertical-align: top; font-family: monospace; font-size: 13px;">${eventsHtml}</td>
          </tr>
        `;
      });
    }

    // =================================================================
    // 2 & 3. 核心改版：各職位人員狀況與空缺天數精算 (Slot Packing 演算法)
    // =================================================================
    const expandedSlots = [];
    
    const sortedRequirements = [...requirements].sort((a, b) => {
        const uDiff = getUnitWeight(a.unit) - getUnitWeight(b.unit);
        if (uDiff !== 0) return uDiff;
        return getRoleWeight(a.position) - getRoleWeight(b.position);
    });

    sortedRequirements.forEach(req => {
        const count = parseInt(req.count, 10) || 1;
        const reqStartMs = req.startDate ? new Date(req.startDate).getTime() : 0;
        const reqEndMs = req.endDate ? new Date(req.endDate).getTime() : Infinity;

        if (reqStartMs > endMs || reqEndMs < startMs) return;

        // 建立法定的基準 Slots
        const slotsForThisReq = Array.from({ length: count }, (_, i) => ({
            unit: req.unit,
            role: req.position,
            slotIndex: i + 1,
            isOverstaffed: false, // 標記是否為超編
            occupants: [],
            vacancies: [] 
        }));

        // 撈取並過濾屬於此職位的人員歷程
        const candidatePeriods = [];
        personnel.forEach(p => {
            const hireDateMs = new Date(p.hireDate).getTime();
            const contractStartMs = new Date(p.contractStart || p.hireDate).getTime();
            const pStartMs = Math.max(hireDateMs, contractStartMs);
            const pEndMs = p.contractEnd ? new Date(p.contractEnd).getTime() : Infinity;

            (p.history || []).forEach((h, idx) => {
                if (h.unit === req.unit && h.role === req.position) {
                    let hStartMs = new Date(h.startDate).getTime();
                    // 第一筆歷程嚴格綁定到職與計畫起始日
                    if (idx === 0) hStartMs = Math.max(hStartMs, pStartMs);

                    const hEndMs = Math.min(h.endDate ? new Date(h.endDate).getTime() : Infinity, pEndMs);
                    
                    const overlapStart = Math.max(hStartMs, reqStartMs, startMs);
                    const overlapEnd = Math.min(hEndMs, reqEndMs, endMs);

                    if (overlapStart <= overlapEnd) {
                        const displayStartMs = Math.max(hStartMs, projStartMs);
                        const displayStartDateStr = new Date(displayStartMs).toISOString().split('T')[0];

                        candidatePeriods.push({
                            name: p.name,
                            startMs: overlapStart, // 用於排程演算法
                            endMs: overlapEnd,     // 用於排程演算法
                            startStr: displayStartDateStr,
                            endStr: h.endDate ? h.endDate : (p.contractEnd ? p.contractEnd : '至今')
                        });
                    }
                }
            });
        });

        // 廠商最優化排班 (Packing Algorithm)
        candidatePeriods.sort((a, b) => a.startMs - b.startMs);
        
        candidatePeriods.forEach(period => {
            let assigned = false;
            // 優先找前面的法定 Slot 塞入
            for (let slot of slotsForThisReq) {
                const lastOccupant = slot.occupants[slot.occupants.length - 1];
                // 若 Slot 是空的，或上一個人的結束日早於此人的開始日，則可放入
                if (!lastOccupant || lastOccupant.endMs < period.startMs) {
                    slot.occupants.push(period);
                    assigned = true;
                    break;
                }
            }
            // 【解決重疊擠在一起的 Bug】：如果所有法定 Slot 在此時間點都滿了，動態新增「超編 Slot」安置
            if (!assigned) {
                slotsForThisReq.push({
                    unit: req.unit,
                    role: req.position,
                    slotIndex: slotsForThisReq.length + 1,
                    isOverstaffed: true, // 標記為超編，不計入空缺懲罰
                    occupants: [period],
                    vacancies: []
                });
            }
        });

        // 逐 Slot 計算空缺天數 (僅計算非法定超編的 Slot)
        slotsForThisReq.forEach(slot => {
            if (slot.isOverstaffed) {
                slot.totalVacancyDays = 0;
                slot.vacancyPeriods = [];
                return; // 超編 Slot 不計算空缺天數
            }

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

    // 4. 產出列印用 HTML
    const printContent = `
      <!DOCTYPE html>
      <html lang="zh-TW">
      <head>
        <meta charset="UTF-8">
        <title>人事異動與空缺紀錄表</title>
        <style>
          body { font-family: 'Helvetica Neue', Helvetica, 'PingFang TC', 'Microsoft JhengHei', sans-serif; color: #333; line-height: 1.6; padding: 20px; }
          h1 { text-align: center; color: #1e293b; margin-bottom: 5px; }
          h2 { font-size: 18px; color: #4f46e5; border-bottom: 2px solid #e0e7ff; padding-bottom: 5px; margin-top: 30px; }
          .meta { text-align: center; color: #64748b; font-size: 14px; margin-bottom: 30px; }
          table { border-collapse: collapse; margin-bottom: 20px; width: 100%; font-size: 13px; }
          th, td { border: 1px solid #cbd5e1; padding: 10px 12px; text-align: left; }
          th { background-color: #f8fafc; color: #475569; font-weight: bold; white-space: nowrap; }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .highlight { color: #ea580c; font-weight: bold; }
          .print-btn { display: block; width: 200px; margin: 20px auto; padding: 10px; background: #4f46e5; color: white; text-align: center; text-decoration: none; border-radius: 5px; font-weight: bold; cursor: pointer; }
          @media print { .no-print { display: none !important; } body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="no-print text-center" style="margin-bottom:20px; background:#f0fdf4; padding:15px; border:1px solid #bbf7d0; border-radius:8px;">
          <p style="color:#15803d; font-weight:bold; margin:0 0 10px 0;">報表已產生！請點擊下方按鈕，選擇「儲存為 PDF」即可完成匯出。</p>
          <button class="print-btn" onclick="window.print()">列印 / 儲存為 PDF</button>
        </div>

        <h1>【${projectName}】人事異動與空缺紀錄表</h1>
        <div class="meta">報表統計區間：${startDate} 至 ${endDate} | 產出日期：${getLocalTodayStr()}</div>

        <h2>一、 期間內人事異動軌跡</h2>
        <p style="font-size: 12px; color: #64748b;">說明：列出本區間曾在職之人員及其職務異動。首筆紀錄為參與計畫期間內的最初職位（起始日依據實際加入日與計畫起始日較晚者認定），離職日認定為最後工作日之隔日。人員排序依據其最初職務之單位與職位順序排序。</p>
        <table>
          <tr>
            <th style="width:150px;">姓名</th>
            <th>計劃期間異動軌跡</th>
          </tr>
          ${changeRecordsHtml}
        </table>

        <h2>二、 期間內各職位人員在職狀況 (按編制員額區分)</h2>
        <p style="font-size: 12px; color: #64748b;">說明：依據合約編制員額 (Slot) 獨立列示。若遇交接重疊或廠商增派人力，系統將自動展開超編欄位以呈現完整在職名單。</p>
        <table>
          <tr>
            <th style="width:120px;">單位</th>
            <th style="width:120px;">職位</th>
            <th style="width:90px;" class="text-center">員額編號</th>
            <th>在職人員與期間</th>
          </tr>
          ${expandedSlots.map(slot => {
            const slotLabel = slot.isOverstaffed 
              ? `員額 ${slot.slotIndex}<br><span style="color:#ef4444;font-size:10px;">(超編/交接)</span>` 
              : `員額 ${slot.slotIndex}`;

            return `
              <tr>
                <td>${slot.unit}</td>
                <td>${slot.role}</td>
                <td class="text-center">${slotLabel}</td>
                <td>
                  ${slot.occupants.length > 0 
                    ? slot.occupants.map(occ => `<div style="margin-bottom:2px;"><strong>${occ.name}</strong> (${occ.startStr} ~ ${occ.endStr})</div>`).join('')
                    : '<span style="color:#94a3b8;">(此員額於期間內全段空缺)</span>'}
                </td>
              </tr>
            `;
          }).join('')}
        </table>

        <h2>三、 職位空缺天數精算 (扣款依據參考)</h2>
        <p style="font-size: 12px; color: #64748b;">說明：依據上方「法定員額」逐日比對計算。超編與重疊交接的額外人力不計入空缺懲罰，總計單位為「人天」。</p>
        <table>
          <tr>
            <th>需求單位</th>
            <th>要求職位</th>
            <th class="text-center">員額</th>
            <th>確切空缺日期區間</th>
            <th class="text-right">累計空缺人天</th>
          </tr>
          ${expandedSlots.filter(s => s.totalVacancyDays > 0 && !s.isOverstaffed).length === 0 
            ? '<tr><td colspan="5" class="text-center" style="color:#94a3b8;">此區間內法定人力編制皆合乎規定，無空缺異常。</td></tr>'
            : expandedSlots.filter(s => s.totalVacancyDays > 0 && !s.isOverstaffed).map(s => `
                <tr>
                  <td rowspan="${Math.max(1, s.vacancyPeriods.length)}">${s.unit}</td>
                  <td rowspan="${Math.max(1, s.vacancyPeriods.length)}">${s.role}</td>
                  <td rowspan="${Math.max(1, s.vacancyPeriods.length)}" class="text-center">員額 ${s.slotIndex}</td>
                  <td>${s.vacancyPeriods[0]?.start} ~ ${s.vacancyPeriods[0]?.end}</td>
                  <td class="text-right highlight" style="font-size:15px;">${s.vacancyPeriods[0]?.days} 天</td>
                </tr>
                ${s.vacancyPeriods.slice(1).map(vp => `
                  <tr>
                    <td>${vp.start} ~ ${vp.end}</td>
                    <td class="text-right highlight" style="font-size:15px;">${vp.days} 天</td>
                  </tr>
                `).join('')}
              `).join('')
          }
          <tr style="background:#f8fafc; font-weight:bold;">
            <td colspan="4" class="text-right">總計空缺人天：</td>
            <td class="text-right" style="font-size:18px; color:#ef4444;">${expandedSlots.filter(s => !s.isOverstaffed).reduce((acc, s) => acc + (s.totalVacancyDays || 0), 0)} 人天</td>
          </tr>
        </table>
        
        <div style="margin-top: 50px; display: flex; justify-content: space-between; padding: 0 50px;">
          <div><p>承辦人簽章：</p><br/><br/><br/><p>_____________________</p></div>
          <div><p>專案主管簽章：</p><br/><br/><br/><p>_____________________</p></div>
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '', 'width=900,height=800');
    printWindow.document.write(printContent);
    printWindow.document.close();
    
    // 自動聚焦並準備列印
    setTimeout(() => {
      printWindow.focus();
    }, 500);

    showMessage('success', '✅ 異動與空缺紀錄表已在新視窗產生，請檢視並列印。');
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-300">
      
      {/* 提示訊息區塊 */}
      {message && (
        <div className={`p-4 rounded-xl border flex items-start shadow-sm animate-in slide-in-from-top-2 ${
          message.type === 'error' 
            ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400'
            : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
        }`}>
          {message.type === 'error' ? <AlertCircle size={20} className="mr-3 flex-shrink-0 mt-0.5" /> : <CheckCircle2 size={20} className="mr-3 flex-shrink-0 mt-0.5" />}
          <span className="text-sm font-bold leading-relaxed">{message.text}</span>
        </div>
      )}

      {/* 頂部設定區塊 */}
      <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center">
            <Calculator className="mr-3 text-indigo-500" size={24} />
            核銷作業報表中心
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">請先設定欲產出報表的日期區間，再點擊下方對應的報表匯出按鈕。</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center space-y-3 sm:space-y-0 sm:space-x-3 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 w-full md:w-auto transition-colors">
          <div className="flex items-center w-full sm:w-auto">
            <Calendar className="text-slate-400 dark:text-slate-500 mr-2" size={18} />
            <input 
              type="date" 
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent text-sm font-bold text-slate-700 dark:text-slate-200 outline-none w-full cursor-pointer" 
            />
          </div>
          <span className="text-slate-400 font-bold hidden sm:inline">至</span>
          <div className="flex items-center w-full sm:w-auto">
            <span className="text-slate-400 font-bold sm:hidden mr-2">至</span>
            <input 
              type="date" 
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent text-sm font-bold text-slate-700 dark:text-slate-200 outline-none w-full cursor-pointer" 
            />
          </div>
        </div>
      </div>

      {/* 報表下載選項 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* 報表 1 */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm flex flex-col h-full group hover:border-indigo-300 dark:hover:border-indigo-500/50 transition-colors">
          <div className="p-4 bg-blue-50 dark:bg-blue-500/10 rounded-2xl w-fit mb-5 group-hover:scale-110 transition-transform">
            <FileText className="text-blue-600 dark:text-blue-400" size={28} />
          </div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">1. 人員考勤匯總表</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 flex-1 mb-8 leading-relaxed">
            包含所選區間內的出勤總天數、各類假別明細、規政代理人簽核紀錄與異常標記。
          </p>
          <button 
            onClick={exportAttendanceCSV} 
            disabled={!isDataLoaded}
            className="w-full flex justify-center items-center space-x-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-bold rounded-xl transition-all active:scale-95 shadow-sm"
          >
            {isDataLoaded ? <Download size={16} /> : <Loader2 size={16} className="animate-spin" />}
            <span>匯出 Excel (CSV)</span>
          </button>
        </div>

        {/* 報表 2 */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm flex flex-col h-full group hover:border-orange-300 dark:hover:border-orange-500/50 transition-colors relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-orange-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl shadow-sm">核心稽核功能</div>
          <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 rounded-2xl w-fit mb-5 group-hover:scale-110 transition-transform">
            <Users className="text-emerald-600 dark:text-emerald-400" size={28} />
          </div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">2. 異動與空缺紀錄表</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 flex-1 mb-8 leading-relaxed">
            詳列期間內的人員到離職與調職軌跡，並自動精算計畫駐點人力之「空缺天數」。
          </p>
          <button 
            onClick={exportVacancyReportPDF} 
            disabled={!isDataLoaded}
            className="w-full flex justify-center items-center space-x-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-bold rounded-xl transition-all active:scale-95 shadow-sm"
          >
            {isDataLoaded ? <Download size={16} /> : <Loader2 size={16} className="animate-spin" />}
            <span>匯出 PDF (列印排版)</span>
          </button>
        </div>

        {/* 報表 3 */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm flex flex-col h-full group hover:border-amber-300 dark:hover:border-amber-500/50 transition-colors">
          <div className="p-4 bg-amber-50 dark:bg-amber-500/10 rounded-2xl w-fit mb-5 group-hover:scale-110 transition-transform">
            <CheckSquare className="text-amber-600 dark:text-amber-400" size={28} />
          </div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">3. 期中/期末成果初稿</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 flex-1 mb-8 leading-relaxed">
            擷取區間內已結案之工項列表與會議清單，作為撰寫正式報告之基底。
          </p>
          <button 
            onClick={exportProgressWord} 
            disabled={!isDataLoaded}
            className="w-full flex justify-center items-center space-x-2 py-3 border-2 border-indigo-100 dark:border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 disabled:opacity-50 text-sm font-bold rounded-xl transition-all active:scale-95"
          >
            {isDataLoaded ? <Download size={16} /> : <Loader2 size={16} className="animate-spin" />}
            <span>產出 Word 初稿</span>
          </button>
        </div>

      </div>
    </div>
  );
}
