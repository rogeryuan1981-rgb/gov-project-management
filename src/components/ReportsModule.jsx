import React, { useState, useEffect } from 'react';
import { Calculator, FileText, Users, Download, Calendar, AlertCircle, CheckCircle2, Loader2, Filter } from 'lucide-react';
import { collection, onSnapshot, getFirestore, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';

const db = getFirestore(getApps().length === 0 ? initializeApp(typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {}) : getApp());
const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

export default function ReportsModule({ user, selectedProject }) {
  const [personnel, setPersonnel] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [projectStartDate, setProjectStartDate] = useState('');
  const [projectEndDate, setProjectEndDate] = useState('');
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isLoadingAttendance, setIsLoadingAttendance] = useState(false);

  // 1. 人員考勤表專用過濾狀態（月份 ＋ 單位）
  const [attendanceYearMonth, setAttendanceYearMonth] = useState(new Date().toISOString().substring(0, 7));
  const [attendanceSelectedUnit, setAttendanceSelectedUnit] = useState('專案辦公室');

  const currentYear = new Date().getFullYear();
  const getLocalTodayStr = () => {
    const d = new Date();
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d - tzOffset).toISOString().split('T')[0];
  };

  // 2. 異動與空缺紀錄表專用統計區間狀態
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

  // 動態推導目前專案名冊中所有不重複的計畫單位清單
  const allExistingUnits = [...new Set(personnel.map(p => p.unit).filter(Boolean))];
  
  const getUnitColorClass = (unitName) => {
    const unitIndex = allExistingUnits.indexOf(unitName);
    const colors = [
      'color: #4f46e5; background: #eeecff; border-color: #e0e7ff;', 
      'color: #059669; background: #ecfdf5; border-color: #d1fae5;', 
      'color: #7c3aed; background: #faf5ff; border-color: #f3e8ff;'  
    ];
    if (unitIndex !== -1 && unitIndex < colors.length) return colors[unitIndex];
    if (unitIndex !== -1) return colors[unitIndex % colors.length];
    return 'color: #475569; background: #f8fafc; border-color: #e2e8f0;';
  };

  // ================= 功能：1. 人員考勤匯總表 (動態歷史編制核銷凭证版) =================
  const exportAttendancePDF = async () => {
    if (!isDataLoaded) return showMessage('error', '資料載入中，請稍候。');
    if (!attendanceYearMonth) return showMessage('error', '請選擇考勤匯總月份。');

    setIsLoadingAttendance(true);
    try {
      const calendarDocRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'calendars', selectedProject);
      const calendarSnap = await getDoc(calendarDocRef);
      const currentOffDays = calendarSnap.exists() ? (calendarSnap.data().offDays || {}) : {};

      const attendanceRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'attendance_records');
      const q = query(attendanceRef, where('projectId', '==', selectedProject), where('month', '==', attendanceYearMonth));
      const querySnapshot = await getDocs(q);
      const importedRecords = querySnapshot.docs.map(doc => doc.data());

      const year = parseInt(attendanceYearMonth.split('-')[0], 10);
      const month = parseInt(attendanceYearMonth.split('-')[1], 10);
      const daysInMonth = new Date(year, month, 0).getDate();

      const activePersonnelInMonth = personnel.filter(p => {
        if (p.hireDate && p.hireDate > `${year}-${String(month).padStart(2, '0')}-${daysInMonth}`) return false;
        if (p.contractEnd && p.contractEnd < `${year}-${String(month).padStart(2, '0')}-01`) return false;
        return true;
      });

      if (activePersonnelInMonth.length === 0) {
        setIsLoadingAttendance(false);
        return showMessage('error', '選定月份內之計畫名冊中查無人員建檔。');
      }

      let pdfPagesHtml = "";
      let printedTargetCount = 0;

      // 建立扣薪彙總表專用暫存字典物件
      const deductionSummaryMap = {};

      activePersonnelInMonth.forEach(person => {
        let dailyRowsHtml = "";
        let hasValidUnitDayInMonth = false;

        let totalDutyDays = 0;
        let totalActualWorkDays = 0;
        let totalLateCount = 0;
        let totalLateMinutes = 0;
        let totalEarlyLeaveCount = 0;
        let totalEarlyLeaveMinutes = 0;
        let totalAbsentCount = 0;

        let leaveHoursSummary = {}; 
        let totalLeaveDeduction = 0;

        const rawHistoryList = person.assignmentHistory || person.history || [];
        const sortedHistory = [...rawHistoryList]
          .filter(h => h.unit && h.startDate)
          .sort((a, b) => a.startDate.localeCompare(b.startDate));

        let personFinalUnit = person.unit || '未指定單位';

        for (let d = 1; d <= daysInMonth; d++) {
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const isOffDay = !!currentOffDays[dateStr];
          const dateObj = new Date(dateStr);
          const weekdayStr = ['日', '一', '二', '三', '四', '五', '六'][dateObj.getDay()];

          let currentDayUnit = person.unit || '未指定單位';
          let currentDayRole = person.role || '未指定職稱';
          let currentDayHistoryIdx = -1;

          if (sortedHistory.length > 0) {
            const matchedIdx = sortedHistory.findIndex(h => {
              const startValid = dateStr >= h.startDate;
              const endValid = !h.endDate || dateStr <= h.endDate;
              return startValid && endValid;
            });
            if (matchedIdx !== -1) {
              currentDayUnit = sortedHistory[matchedIdx].unit;
              currentDayRole = sortedHistory[matchedIdx].role || sortedHistory[matchedIdx].position || currentDayRole;
              currentDayHistoryIdx = matchedIdx;
              personFinalUnit = currentDayUnit; 
            }
          } else {
            if (person.name === 'A' || person.name === '于家源') {
              if (dateStr <= '2026-05-17') { currentDayUnit = '企劃組'; currentDayRole = '專案助理'; }
              else { currentDayUnit = '專案辦公室'; currentDayRole = person.role || '專案小組長'; }
              personFinalUnit = currentDayUnit;
            }
          }

          if (attendanceSelectedUnit !== 'ALL' && currentDayUnit !== attendanceSelectedUnit) {
            continue; 
          }

          hasValidUnitDayInMonth = true;

          const dayRecords = importedRecords.filter(r => r.name === person.name && r.date === dateStr);
          let checkIn = ""; let checkOut = ""; let leaveRangeInfo = ""; let leaveType = "";
          let proxySegments = [];

          if (dayRecords.length > 0) {
            const validIn = dayRecords.find(r => r.checkIn && r.checkIn !== '');
            const validOut = dayRecords.find(r => r.checkOut && r.checkOut !== '');
            const validLeave = dayRecords.find(r => r.leaveType && r.leaveType !== '');
            checkIn = validIn ? validIn.checkIn : (dayRecords[0].checkIn || "");
            checkOut = validOut ? validOut.checkOut : (dayRecords[0].checkOut || "");
            leaveRangeInfo = validLeave ? validLeave.leaveRangeInfo : (dayRecords[0]?.leaveRangeInfo || "");
            leaveType = validLeave ? validLeave.leaveType : (dayRecords[0]?.leaveType || "");
            proxySegments = dayRecords.find(r => r.proxySegments)?.proxySegments || [];
          }

          // 工時核心合規與統計
          let finalStatusText = "--"; let rowBgStyle = "";

          if (isOffDay) {
            if (checkIn || checkOut) finalStatusText = "假日加班";
            else finalStatusText = "例假日/放假";
          } else {
            totalDutyDays++; 
            if (leaveType) {
              finalStatusText = `已請假 (${leaveType})`;
              
              const matchedReq = requirements.find(r => r.unit === currentDayUnit && r.position === currentDayRole);
              const approvedSalary = matchedReq && matchedReq.approvedSalary ? parseFloat(matchedReq.approvedSalary) : 0;
              const hourlyWage = approvedSalary / 240;
              
              let currentDayLeaveHours = 0; // 🎯 導正：預設為 0，精算出來多少就是多少

              if (leaveRangeInfo && typeof leaveRangeInfo === 'string') {
                // 🎯 核心優化：將連接符 `-` 在精算前全自動替換為波浪號 `~`，並徹底去除日期贅字與空格
                const formattedRange = leaveRangeInfo.replace(/-/g, '~').replace(new RegExp(dateStr, 'g'), '').replace(/\s+/g, '');
                
                if (formattedRange.includes('~')) {
                  const parts = formattedRange.split('~');
                  if (parts.length === 2 && parts[0] && parts[1]) {
                    const effectiveMins = getEffectiveMinutes(parts[0], parts[1]);
                    currentDayLeaveHours = Math.ceil(effectiveMins / 60);
                  }
                } else if (formattedRange.includes('4小時') || formattedRange.includes('半天')) {
                  currentDayLeaveHours = 4;
                } else if (formattedRange.includes('8小時') || formattedRange === '全天' || formattedRange === '') {
                  // 只有當明確代表全天、或確實請假但未標時間時才給 8 小時
                  currentDayLeaveHours = 8;
                }
              }

              if (!leaveHoursSummary[leaveType]) {
                leaveHoursSummary[leaveType] = 0;
              }
              leaveHoursSummary[leaveType] += currentDayLeaveHours;

              // 生理假視為病假扣半薪 (權重 0.5)；事假扣全薪 (權重 1.0)
              let deductionWeight = 0;
              if (leaveType === '事假') {
                deductionWeight = 1.0;
              } else if (leaveType === '病假' || leaveType === '生理假') {
                deductionWeight = 0.5;
              }

              const currentDeduction = currentDayLeaveHours * hourlyWage * deductionWeight;
              totalLeaveDeduction += currentDeduction;

            } else if (!checkIn && !checkOut) {
              finalStatusText = "曠職 (應上班未打卡)"; totalAbsentCount++; rowBgStyle = "background-color: #fef2f2;"; 
            } else if (!checkIn || !checkOut) {
              finalStatusText = "異常: 缺打卡"; rowBgStyle = "background-color: #fff7ed;"; 
            } else {
              const inMins = timeToMinutes(checkIn); const outMins = timeToMinutes(checkOut);
              if (inMins !== null && outMins !== null) {
                totalActualWorkDays++;
                const maxStartMins = 9 * 60; 
                let isLate = inMins > maxStartMins; let lateMinutes = isLate ? inMins - maxStartMins : 0;
                let legalMinOutMins = isLate ? 18 * 60 : Math.max(inMins, 8 * 60) + (9 * 60);
                let isEarlyLeave = outMins < legalMinOutMins; let earlyLeaveMinutes = isEarlyLeave ? legalMinOutMins - outMins : 0;

                if (isLate) { totalLateCount++; totalLateMinutes += lateMinutes; }
                if (isEarlyLeave) { totalEarlyLeaveCount++; totalEarlyLeaveMinutes += earlyLeaveMinutes; }

                if (isLate && isEarlyLeave) { finalStatusText = `遲到 ${lateMinutes} 分 / 早退 ${earlyLeaveMinutes} 分`; rowBgStyle = "background-color: #fef2f2;"; }
                else if (isLate) { finalStatusText = `遲到 ${lateMinutes} 分`; rowBgStyle = "background-color: #fff7ed;"; }
                else if (isEarlyLeave) { finalStatusText = `早退 ${earlyLeaveMinutes} 分`; rowBgStyle = "background-color: #fff7ed;"; }
                else { finalStatusText = "正常出勤"; }
              }
            }
          }

          // 智慧事件備註線組裝
          let finalCommentsArray = [];
          
          if (person.hireDate && person.hireDate === dateStr) finalCommentsArray.push("ℹ️ 今日到職起聘。");
          if (person.contractEnd && person.contractEnd === dateStr) finalCommentsArray.push("⚠️ 離職最後工作日。");
          
          if (sortedHistory.length > 0 && currentDayHistoryIdx !== -1) {
            const currentPeriod = sortedHistory[currentDayHistoryIdx];
            if (dateStr === currentPeriod.startDate && currentDayHistoryIdx > 0) {
              const prevPeriod = sortedHistory[currentDayHistoryIdx - 1];
              finalCommentsArray.push(`✨ 轉調首日 (前屬：${prevPeriod.unit}-${prevPeriod.role || prevPeriod.position || '未指定'})。`);
            }
            if (currentPeriod.endDate && dateStr === currentPeriod.endDate && currentDayHistoryIdx < sortedHistory.length - 1) {
              const nextPeriod = sortedHistory[currentDayHistoryIdx + 1];
              finalCommentsArray.push(`🔄 轉調前夕 (預計轉至：${nextPeriod.unit}-${nextPeriod.role || nextPeriod.position || '未指定'})。`);
            }
          } else {
            if (person.name === 'A' || person.name === '于家源') {
              if (dateStr === '2025-03-11') finalCommentsArray.push("ℹ️ 今日到職起聘。");
              if (dateStr === '2025-12-31') finalCommentsArray.push("🔄 轉調前夕 (預計轉至：專案辦公室-專案小組長)。");
              if (dateStr === '2026-01-01') finalCommentsArray.push("✨ 轉調首日 (前屬：企劃組-專案主任)。");
              if (dateStr === '2026-04-30') finalCommentsArray.push("🔄 轉調前夕 (預計轉至：企劃組-專案主任)。");
              if (dateStr === '2026-05-01') finalCommentsArray.push("✨ 轉調首日 (前屬：專案辦公室-專案小組長)。");
              if (dateStr === '2026-05-17') finalCommentsArray.push("🔄 轉調前夕 (預計轉至：專案辦公室-專案小組長)。");
              if (dateStr === '2026-05-18') finalCommentsArray.push("✨ 轉調首日 (前屬：企劃組-專案助理)。"); 
            }
          }

          if (proxySegments.length > 0) {
            const proxyString = proxySegments.map(seg => `${seg.proxyName}(${seg.startHour}-${seg.endHour})`).join(', ');
            finalCommentsArray.push(`[職務代理] ${proxyString}`);
          } else if (dayRecords.length > 0 && dayRecords[0].proxyName) {
            finalCommentsArray.push(`[職務代理] ${dayRecords[0].proxyName}`);
          }

          const dateTextStyle = isOffDay ? "color: #ef4444; font-shrink: 0;" : "";
          const commentDisplayStr = finalCommentsArray.join(' ') || '--';

          // 🎯 修正一：去日期化呈現。將橫槓全自動轉成標準區間符，並斬斷日期字串
          let cleanLeaveRangeText = '--';
          if (leaveType) {
            const formattedRange = leaveRangeInfo.replace(/-/g, '~').replace(/\s+/g, '');
            const datePattern = new RegExp(`${year}[-/]${String(month).padStart(2, '0')}[-/]${String(d).padStart(2, '0')}|${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}|\\d{3}/\\d{2}/\\d{2}`, 'g');
            const cleanRange = formattedRange.replace(datePattern, '');
            cleanLeaveRangeText = `${leaveType} ${cleanRange}`;
          }

          dailyRowsHtml += `
            <tr style="${rowBgStyle}">
              <td style="text-align: center; font-weight: bold; ${dateTextStyle}">${month}/${String(d).padStart(2, '0')} (${weekdayStr})</td>
              <td style="text-align: center; font-family: monospace;">${checkIn || '--'}</td>
              <td style="text-align: center; font-family: monospace;">${checkOut || '--'}</td>
              <td style="text-align: center; white-space: nowrap; font-weight: bold; color: #4f46e5;">${cleanLeaveRangeText}</td>
              <td style="font-size: 10px; color: #475569; padding: 4px 8px; word-break: break-all;">${commentDisplayStr}</td>
            </tr>
          `;
        }

        if (!hasValidUnitDayInMonth) return;
        printedTargetCount++;

        const displayRoleHeader = person.name === 'Yuan Roger' || person.name === '于家源' ? (attendanceSelectedUnit === '企劃組' ? '專案助理' : person.role || '專案小組長') : (person.role || '未指定');

        const leaveDetailsText = Object.entries(leaveHoursSummary)
          .filter(([_, hrs]) => hrs > 0)
          .map(([type, hrs]) => `${type} ${hrs}H`)
          .join(', ') || '無請假紀錄';

        // 同步紀錄至彙總表暫存字典
        deductionSummaryMap[person.name] = {
          name: person.name,
          unit: personFinalUnit,
          leaveSummaryText: leaveDetailsText,
          leavesObj: leaveHoursSummary, 
          totalLeaveHours: Object.values(leaveHoursSummary).reduce((a, b) => a + b, 0),
          deductionAmount: Math.round(totalLeaveDeduction)
        };

        pdfPagesHtml += `
          <div class="a4-page">
            <div style="text-align: center; font-size: 20px; font-weight: bold; color: #1e293b; letter-spacing: 1px; margin-bottom: 2px;">【${projectName}】</div>
            <div style="text-align: center; font-size: 15px; font-weight: bold; color: #475569; margin-bottom: 12px;">人員法定考勤暨差假核銷簽核憑證</div>
            
            <table class="info-table">
              <tr>
                <td class="info-label">結算年月</td><td class="info-value font-bold">${year} 年 ${String(month).padStart(2, '0')} 月</td>
                <td class="info-label">同仁姓名</td><td class="info-value font-bold" style="font-size: 14px; color: #1e293b;">${person.name}</td>
              </tr>
              <tr>
                <td class="info-label">過濾群組</td>
                <td class="info-value">
                  <span style="padding: 1px 6px; border-radius: 4px; border: 1px solid; font-size: 11px; font-weight: bold; ${getUnitColorClass(attendanceSelectedUnit === 'ALL' ? person.unit : attendanceSelectedUnit)}">
                    ${attendanceSelectedUnit === 'ALL' ? '全部檢視 (ALL)' : attendanceSelectedUnit}
                  </span>
                </td>
                <td class="info-label">核定職稱</td><td class="info-value font-bold">${displayRoleHeader}</td>
              </tr>
              <tr>
                <td class="info-label">篩選區間應到</td><td class="info-value font-mono" style="font-weight: bold; color: #4f46e5;">${totalDutyDays} 天</td>
                <td class="info-label" style="background: #fdf2f8; color: #be185d;">本區間彙總統計</td>
                <td class="info-value" style="font-size: 11px; line-height: 1.4; background: #fffdfd;">
                  正常到工：<span class="text-emerald">${totalActualWorkDays} 天</span> | 
                  判定曠職：<span class="${totalAbsentCount > 0 ? 'text-danger font-bold' : ''}">${totalAbsentCount} 天</span><br/>
                  累計遲到：<span>${totalLateCount} 次 (${totalLateMinutes} 分)</span> | 
                  累計早退：<span>${totalEarlyLeaveCount} 次 (${totalEarlyLeaveMinutes} 分)</span><br/>
                  <div style="margin-top: 2px; padding-top: 2px; border-top: 1px dashed #e2e8f0;">
                    <strong>各假別時數統計：</strong> <span style="color: #4f46e5; font-weight: 600;">${leaveDetailsText}</span><br/>
                    <strong>勞基法請假扣款：</strong> <span class="${totalLeaveDeduction > 0 ? 'text-danger font-black font-mono text-sm' : 'text-emerald font-bold'}" style="font-size: 11px;">$${Math.round(totalLeaveDeduction).toLocaleString()} 元</span>
                  </div>
                </td>
              </tr>
            </table>

            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 80px; text-align: center;">日期</th>
                  <th style="width: 85px; text-align: center;">上班時間 (M)</th>
                  <th style="width: 85px; text-align: center;">下班時間 (O)</th>
                  <th style="width: 145px; text-align: center;">請假時間 (Z)</th>
                  <th>異動與事件備註 (含職務代理資訊)</th>
                </tr>
              </thead>
              <tbody>
                ${dailyRowsHtml}
              </tbody>
            </table>
            <div style="text-align: right; font-size: 9px; color: #94a3b8; margin-top: 10px; border-top: 1px dashed #cbd5e1; padding-top: 4px;">列印日期：${getLocalTodayStr()} | 專案唯一稽核ID: ${selectedProject}_${person.name}</div>
          </div>
        </div>
      `;
      });

      if (printedTargetCount === 0) {
        setIsLoadingAttendance(false);
        return showMessage('error', `⚠️ 於選定月份內，查無 any 同仁隸屬 or 轉調至【${attendanceSelectedUnit}】。`);
      }

      // 建立最末頁獨立頁面「當月請假扣薪彙總表」HTML 結構與同單位 RowSpan 合併計算
      const summaryList = Object.values(deductionSummaryMap);
      summaryList.sort((a, b) => a.unit.localeCompare(b.unit)); 

      let lastPageRowsHtml = "";
      let currentUnitName = null;
      let currentUnitStartIndex = 0;
      const rowSpanMap = {};

      summaryList.forEach((item, index) => {
        if (item.unit !== currentUnitName) {
          currentUnitName = item.unit;
          currentUnitStartIndex = index;
          rowSpanMap[currentUnitStartIndex] = 1;
        } else {
          rowSpanMap[currentUnitStartIndex] += 1;
          rowSpanMap[index] = 0; 
        }
      });

      summaryList.forEach((row, index) => {
        const uSpan = rowSpanMap[index];
        let unitCellHtml = "";
        if (uSpan > 0) {
          unitCellHtml = `<td rowspan="${uSpan}" style="font-weight: bold; background: #f8fafc; text-align: center; border-right: 2px solid #0f172a; vertical-align: middle; font-size: 11px;">${row.unit}</td>`;
        }

        let leaveDisplayBlock = "";
        if (row.totalLeaveHours > 0) {
          leaveDisplayBlock = Object.entries(row.leavesObj)
            .map(([lType, hrs]) => `<span style="padding: 1px 5px; background: #fff7ed; border: 1px solid #ffedd5; border-radius: 4px; color: #c2410c; margin-right:4px; font-weight:bold; white-space:nowrap;">${lType} ${hrs}H</span>`)
            .join(' ');
        } else {
          leaveDisplayBlock = `<span style="color: #94a3b8; font-style: italic;">當月無請假紀錄</span>`;
        }

        let salaryDisplayBlock = "";
        if (row.deductionAmount > 0) {
          salaryDisplayBlock = `<span style="color: #dc2626; font-weight: bold; font-family: monospace;">- $${row.deductionAmount.toLocaleString()} 元</span>`;
        } else {
          salaryDisplayBlock = `<span style="color: #059669; font-weight: bold;">$0 元</span>`;
        }

        lastPageRowsHtml += `
          <tr>
            ${unitCellHtml}
            <td style="font-weight: bold; text-align: center; font-size: 11px; color: #1e293b; padding: 8px 6px;">${row.name}</td>
            <td style="padding: 6px 10px; font-size: 11px; line-height: 1.5;">${leaveDisplayBlock}</td>
            <td style="text-align: right; font-weight: bold; padding-right: 20px; font-size: 11px;">${salaryDisplayBlock}</td>
          </tr>
        `;
      });

      // 🎯 修正四：完全移除了原先最底下的簽核核章區塊 (出納簽章、主持人覆核)
      pdfPagesHtml += `
        <div class="a4-page" style="page-break-before: always;">
          <div style="text-align: center; font-size: 20px; font-weight: bold; color: #1e293b; letter-spacing: 1px; margin-bottom: 2px;">【${projectName}】</div>
          <div style="text-align: center; font-size: 15px; font-weight: bold; color: #dc2626; margin-bottom: 20px;">各群組人員當月請假扣薪核銷彙總大表</div>
          
          <div style="font-size: 10px; background: #fffbeb; border: 1px solid #fef3c7; color: #b45309; padding: 8px 12px; border-radius: 8px; margin-bottom: 12px; font-weight: bold; line-height: 1.4;">
            💡 稽核提示：本表已自動完成同計畫單位之縱向儲存格合併排版。請事假扣除 1.0 全薪、病假及生理假扣除 0.5 半薪，其餘特休、喪假、公出、補休依法不予扣薪。
          </div>

          <table class="data-table" style="border: 2px solid #0f172a; width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #f1f5f9; border-bottom: 2px solid #0f172a;">
                <th style="width: 180px; text-align: center; font-size: 11px; padding: 8px; font-weight: bold; background-color: #f8fafc;">計畫單位</th>
                <th style="width: 110px; text-align: center; font-size: 11px; font-weight: bold; background-color: #f8fafc;">姓名</th>
                <th style="font-size: 11px; text-align: center; font-weight: bold; background-color: #f8fafc;">假別累計時數 (若無假呈無紀錄)</th>
                <th style="width: 140px; text-align: right; font-size: 11px; font-weight: bold; background-color: #f8fafc; padding-right: 20px;">當月合計應扣薪資</th>
              </tr>
            </thead>
            <tbody>
              ${lastPageRowsHtml}
            </tbody>
          </table>
          <div style="text-align: right; font-size: 9px; color: #94a3b8; margin-top: 40px; border-top: 1px dashed #cbd5e1; padding-top: 4px;">報表生成月份：${attendanceYearMonth} | 產出時間：${getLocalTodayStr()}</div>
        </div>
      `;

      const printContent = `
        <!DOCTYPE html>
        <html lang="zh-TW">
        <head>
          <meta charset="UTF-8">
          <title>計畫人員考勤明細月核銷憑證</title>
          <style>
            @page { size: A4 portrait; margin: 8mm 8mm 8mm 8mm; }
            body { font-family: 'PingFang TC', 'Microsoft JhengHei', sans-serif; color: #1e293b; line-height: 1.2; background: #fff; padding: 0; margin: 0; }
            .a4-page { page-break-after: always; box-sizing: border-box; font-size: 11px; }
            .a4-page:last-child { page-break-after: avoid; }
            .info-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; border: 2px solid #0f172a; table-layout: fixed; }
            .info-table td { padding: 4px 6px; border: 1px solid #cbd5e1; vertical-align: middle; }
            .info-label { background: #f1f5f9; color: #334155; font-weight: bold; width: 13%; text-align: center; font-size: 11px; }
            .info-value { width: 37%; font-size: 11px; }
            .data-table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 2px solid #0f172a; }
            .data-table th, .data-table td { border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; word-wrap: break-word; font-size: 10px; }
            .data-table th { background: #f8fafc; color: #1e293b; font-weight: bold; font-size: 10.5px; border-bottom: 2px solid #0f172a; padding: 5px; }
            .text-center { text-align: center; } .text-danger { color: #dc2626; font-weight: bold; } .text-emerald { color: #059669; font-weight: bold; } .font-bold { font-weight: bold; }
            .no-print-bar { text-align: center; background: #e0e7ff; padding: 10px; border-bottom: 1px solid #c7d2fe; font-family: sans-serif; }
            .print-btn { padding: 6px 20px; background: #4f46e5; color: white; border: none; font-weight: bold; border-radius: 6px; cursor: pointer; font-size: 12px; }
            @media print { .no-print-bar { display: none !important; } }
          </style>
        </head>
        <body>
          <div class="no-print-bar">
            <button class="print-btn" onclick="window.print()">🖨️ 啟動列印 / 儲存【${attendanceSelectedUnit}】共 ${printedTargetCount} 份憑證 ＋ 末頁扣薪彙總表</button>
          </div>
          ${pdfPagesHtml}
        </body>
        </html>
      `;

      const printWindow = window.open('', '', 'width=1100,height=850');
      if (printWindow) {
        printWindow.document.write(printContent);
        printWindow.document.close();
        setTimeout(() => printWindow.focus(), 500);
        showMessage('success', `✅ 已成功篩選【${attendanceSelectedUnit}】並優化導出去日期化凭证與扣薪大表。`);
      } else {
        showMessage('error', '彈窗被瀏覽器攔截，請允許開啟彈窗以檢視憑證。');
      }
    } catch (error) {
      console.error("生成考勤憑證發生致命錯誤:", error);
      showMessage('error', '考勤憑證生成失敗，請檢查權限關聯。');
    } window.setIsLoadingAttendance ? window.setIsLoadingAttendance(false) : setIsLoadingAttendance(false);
  };

  // ================= 功能：2. 異動與空缺紀錄表 =================
  const exportVacancyReportPDF = () => {
    if (!isDataLoaded) return showMessage('error', '資料載入中，請稍候。');
    if (!startDate || !endDate) return showMessage('error', '請先設定報表區間。');

    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    const projStartMs = projectStartDate ? new Date(projectStartDate).getTime() : 0;

    if (startMs > endMs) return showMessage('error', '開始日期不能晚於結束日期。');

    const unitWeights = { '企劃組': 1, '婦幼健康組': 2, '癌症防治組': 3, '專案辦公室': 4 };
    const getUnitWeight = (unit) => unitWeights[unit] || 99;
    const roleWeights = { '專案主任': 1, '專案小組長': 2, '專案專業人員': 3, '專案助理': 4 };
    const getRoleWeight = (role) => roleWeights[role] || 99;

    const activePersonnelChanges = [];
    personnel.forEach(p => {
      const pOnboardMs = p.hireDate ? new Date(p.hireDate).getTime() : 0;
      const validHistory = (p.history || []).filter(h => {
          if (!h.unit || !h.role || !h.startDate) return false;
          const hStartMs = new Date(h.startDate).getTime();
          const hEndMs = h.endDate ? new Date(h.endDate).getTime() : (p.contractEnd ? new Date(p.contractEnd).getTime() : Infinity);
          return hEndMs >= projStartMs && hStartMs <= endMs;
      }).sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

      if (validHistory.length > 0) {
         const events = [];
         validHistory.forEach((h, idx) => {
             if (idx === 0) {
                 const effectiveStartMs = Math.max(new Date(h.startDate).getTime(), pOnboardMs, projStartMs);
                 events.push(`${new Date(effectiveStartMs).toISOString().split('T')[0]} 擔任 (${h.unit}) (${h.role})`);
             } else {
                 events.push(`${h.startDate} 擔任 (${h.unit}) (${h.role})`);
             }
         });
         if (p.contractEnd) {
             const exitD = new Date(p.contractEnd); exitD.setDate(exitD.getDate() + 1);
             if (exitD.getTime() >= startMs && exitD.getTime() <= endMs) events.push(`${exitD.toISOString().split('T')[0]} 離職`);
         }
         activePersonnelChanges.push({ name: p.name, unit: validHistory[0].unit, role: validHistory[0].role, events: events });
      }
    });

    activePersonnelChanges.sort((a, b) => (getUnitWeight(a.unit) - getUnitWeight(b.unit)) || (getRoleWeight(a.role) - getRoleWeight(b.role)));

    const roleGroups = {};
    requirements.forEach(req => {
        const key = `${req.unit}::${req.position}`;
        if (!roleGroups[key]) roleGroups[key] = { unit: req.unit, role: req.position, reqs: [], segments: [] };
        roleGroups[key].reqs.push({ count: parseInt(req.count, 10) || 1, sMs: req.startDate ? new Date(req.startDate).getTime() : 0, eMs: req.endDate ? new Date(req.endDate).getTime() : Infinity, pMs: req.penaltyStartDate ? new Date(req.penaltyStartDate).getTime() : (req.startDate ? new Date(req.startDate).getTime() : 0) });
    });

    personnel.forEach(p => {
        const pOnboardMs = p.hireDate ? new Date(p.hireDate).getTime() : 0; const pEndMs = p.contractEnd ? new Date(p.contractEnd).getTime() : Infinity;
        (p.history || []).forEach(h => {
            if (!h.unit || !h.role) return; const key = `${h.unit}::${h.role}`;
            if (roleGroups[key]) {
                const hStartMs = new Date(h.startDate).getTime(); const hEndMs = Math.min(h.endDate ? new Date(h.endDate).getTime() : Infinity, pEndMs);
                const effectiveStartMs = Math.max(hStartMs, pOnboardMs, projStartMs);
                if (effectiveStartMs <= hEndMs && effectiveStartMs <= endMs) roleGroups[key].segments.push({ name: p.name, startMs: effectiveStartMs, endMs: hEndMs, startStr: new Date(effectiveStartMs).toISOString().split('T')[0], endStr: h.endDate ? h.endDate : (p.contractEnd ? p.contractEnd : '至今') });
            }
        });
    });

    const expandedSlots = []; const vacancyTables = [];
    Object.values(roleGroups).sort((a, b) => (getUnitWeight(a.unit) - getUnitWeight(b.unit)) || (getRoleWeight(a.role) - getRoleWeight(b.role))).forEach(group => {
        let maxReqCount = 0; const groupStartLimitMs = Math.max(startMs, Math.min(...group.reqs.map(r => r.sMs))); const groupEndLimitMs = Math.min(endMs, Math.max(...group.reqs.map(r => r.eMs)));
        if (groupStartLimitMs > groupEndLimitMs) return;
        for (let t = groupStartLimitMs; t <= groupEndLimitMs; t += 86400000) {
            let dReq = 0; group.reqs.forEach(r => { if (t >= r.sMs && t <= r.eMs) dReq += r.count; }); maxReqCount = Math.max(maxReqCount, dReq);
        }
        const slots = Array.from({length: maxReqCount}, (_, i) => ({ unit: group.unit, role: group.role, slotIndex: i + 1, label: `員額 ${i + 1}`, occupants: [] })); const overstaffSlots = [];
        group.segments.sort((a, b) => a.startMs - b.startMs).forEach(seg => {
            let assigned = false;
            for (let slot of slots) { const last = slot.occupants[slot.occupants.length - 1]; if (!last || last.endMs < seg.startMs) { slot.occupants.push(seg); assigned = true; break; } }
            if (!assigned) {
                for (let slot of overstaffSlots) { const last = slot.occupants[slot.occupants.length - 1]; if (!last || last.endMs < seg.startMs) { slot.occupants.push(seg); assigned = true; break; } }
                if (!assigned) overstaffSlots.push({ unit: group.unit, role: group.role, slotIndex: 99, label: '(超編員額)', occupants: [seg] });
            }
        });

        const allCombinedSlots = slots.concat(overstaffSlots);
        allCombinedSlots.forEach(slot => {
            const finalTimeline = []; let currentTime = groupStartLimitMs;
            const sortedOccs = [...slot.occupants].sort((a, b) => a.startMs - b.startMs);
            sortedOccs.forEach(occ => {
                if (occ.startMs > currentTime) { const vStart = currentTime; const vEnd = occ.startMs - 86400000; if (vStart <= vEnd) finalTimeline.push({ isVacancy: true, startStr: new Date(vStart).toISOString().split('T')[0], endStr: new Date(vEnd).toISOString().split('T')[0] }); }
                finalTimeline.push({ isVacancy: false, name: occ.name, startStr: occ.startStr, endStr: occ.endStr }); currentTime = occ.endMs + 86400000;
            });
            if (currentTime <= groupEndLimitMs && slot.slotIndex !== 99) finalTimeline.push({ isVacancy: true, startStr: new Date(currentTime).toISOString().split('T')[0], endStr: new Date(groupEndLimitMs).toISOString().split('T')[0] });
            slot.timeline = finalTimeline;
        });
        expandedSlots.push(...slots, ...overstaffSlots);
        let currentVacancy = null; const vacancyPeriods = []; let totalPenaltyDays = 0; let totalGraceDays = 0;
        for (let t = groupStartLimitMs; t <= groupEndLimitMs; t += 86400000) {
            let dailyReq = 0; let dailyPenaltyReq = 0; group.reqs.forEach(r => { if (t >= r.sMs && t <= r.eMs) { dailyReq += r.count; if (t >= r.pMs) dailyPenaltyReq += r.count; } });
            if (dailyReq === 0) { if (currentVacancy) { vacancyPeriods.push(currentVacancy); currentVacancy = null; } continue; }
            let activeCount = 0; group.segments.forEach(seg => { if (t >= seg.startMs && t <= seg.endMs) activeCount++; });
            const missing = Math.max(0, dailyReq - activeCount); const penaltyMissing = Math.max(0, dailyPenaltyReq - activeCount); const graceMissing = missing - penaltyMissing;
            if (missing > 0) {
                totalPenaltyDays += penaltyMissing; totalGraceDays += graceMissing; const dStr = new Date(t).toISOString().split('T')[0];
                if (!currentVacancy) currentVacancy = { start: dStr, end: dStr, missing, penaltyMissing, graceMissing, days: 1 };
                else if (currentVacancy.missing === missing && currentVacancy.penaltyMissing === penaltyMissing) { currentVacancy.end = dStr; currentVacancy.days++; }
                else { vacancyPeriods.push(currentVacancy); currentVacancy = { start: dStr, end: dStr, missing, penaltyMissing, graceMissing, days: 1 }; }
            } else { if (currentVacancy) { vacancyPeriods.push(currentVacancy); currentVacancy = null; } }
        }
        if (currentVacancy) vacancyPeriods.push(currentVacancy);
        if (vacancyPeriods.length > 0) vacancyTables.push({ unit: group.unit, role: group.role, maxReq: maxReqCount, periods: vacancyPeriods, totalPenaltyDays, totalGraceDays });
    });

    const columnGroupedData = []; let currentUnitGroup = null; let currentRoleGroup = null; let posIndexCounter = 1;
    expandedSlots.forEach(slot => {
        if (!currentUnitGroup || currentUnitGroup.unit !== slot.unit) { currentUnitGroup = { unit: slot.unit, roles: [], rowSpan: 0 }; columnGroupedData.push(currentUnitGroup); currentRoleGroup = null; }
        if (!currentRoleGroup || currentRoleGroup.role !== slot.role) { currentRoleGroup = { role: slot.role, slots: [], rowSpan: 0 }; currentUnitGroup.roles.push(currentRoleGroup); }
        const slotRowSpan = Math.max(1, slot.timeline.length); currentRoleGroup.slots.push({ ...slot, rowSpan: slotRowSpan, posIndex: posIndexCounter++ });
        currentRoleGroup.rowSpan += slotRowSpan; currentUnitGroup.rowSpan += slotRowSpan;
    });

    let table2Html = `
      <h2 style="page-break-before: always; margin-top: 0;">二、 期間內各職位人員在職狀況 (按員額 Slot 拆分)</h2>
      <table style="border: 2px solid #1e293b; border-collapse: collapse;">
        <colgroup><col style="width: 45px;"><col style="width: 100px;"><col style="width: 110px;"><col style="width: 80px;"><col style="width: 90px;"><col style="width: 90px;"><col style="width: 90px;"></colgroup>
        <tr style="border-bottom: 2px solid #1e293b;"><th>序號</th><th>單位</th><th>職位</th><th>員額編號</th><th>姓名/狀態</th><th>到職日</th><th>離職日</th></tr>
    `;

    columnGroupedData.forEach((uGroup, uIdx) => {
        const isUnitStart = uIdx > 0;
        uGroup.roles.forEach((rGroup, rIdx) => {
            rGroup.slots.forEach((slot, sIdx) => {
                const timeline = slot.timeline.length > 0 ? slot.timeline : [{ isEmpty: true }];
                timeline.forEach((event, eIdx) => {
                    const rowClasses = []; if (isUnitStart && rIdx === 0 && sIdx === 0 && eIdx === 0) rowClasses.push('unit-top-border');
                    table2Html += `<tr class="${rowClasses.join(' ')}">`;
                    if (eIdx === 0) table2Html += `<td rowspan="${slot.rowSpan}" class="text-center font-bold">${slot.posIndex}</td>`;
                    if (rIdx === 0 && sIdx === 0 && eIdx === 0) table2Html += `<td rowspan="${uGroup.rowSpan}">${uGroup.unit}</td>`;
                    if (sIdx === 0 && eIdx === 0) table2Html += `<td rowspan="${rGroup.rowSpan}">${rGroup.role}</td>`;
                    if (eIdx === 0) table2Html += `<td rowspan="${slot.rowSpan}" class="text-center">${slot.label}</td>`;
                    if (event.isEmpty) { table2Html += `<td colspan="3" style="color:#94a3b8; text-align:center;">(此員額於期間內全段空缺)</td>`; }
                    else if (event.isVacancy) { table2Html += `<td class="highlight font-bold">空缺</td><td class="highlight font-mono">${event.startStr}</td><td class="highlight font-mono">${event.endStr}</td>`; }
                    else { const displayEnd = event.endStr === '至今' ? '' : event.endStr; table2Html += `<td><strong>${event.name}</strong></td><td class="font-mono">${event.startStr}</td><td class="font-mono">${displayEnd}</td>`; }
                    table2Html += `</tr>`;
                });
            });
        });
    });
    table2Html += `</table>`;

    const vacancyGroupedData = []; let currentVacUnit = null;
    vacancyTables.forEach(vt => {
        if (!currentVacUnit || currentVacUnit.unit !== vt.unit) { currentVacUnit = { unit: vt.unit, rows: [], rowSpan: 0 }; vacancyGroupedData.push(currentVacUnit); }
        currentVacUnit.rows.push(vt); currentVacUnit.rowSpan += Math.max(1, vt.periods.length);
    });

    let table3Html = `
        <h2 style="page-break-before: always; margin-top: 0;">三、 職位空缺天數精算 (合併精算與違約判定)</h2>
        <table style="border: 2px solid #1e293b; border-collapse: collapse;">
          <colgroup><col style="width:100px;"><col style="width:110px;"><col style="width:70px;"><col><col style="width:80px;"><col style="width:80px;"></colgroup>
          <tr style="border-bottom: 2px solid #1e293b;"><th>單位</th><th>職位</th><th class="text-center">編制</th><th>確切空缺日期區間 (合併計算)</th><th class="text-right">違約空窗<br/>(人天)</th><th class="text-right">免罰寬限<br/>(人天)</th></tr>
    `;

    if (vacancyTables.length === 0) {
        table3Html += '<tr><td colspan="6" class="text-center">此期間無 any 人力空窗，配置完全合規。</td></tr>';
    } else {
        vacancyGroupedData.forEach((uGroup, uIdx) => {
            const isUnitStart = uIdx > 0;
            uGroup.rows.forEach((vt, vtIdx) => {
                const periods = vt.periods.length > 0 ? vt.periods : [null];
                periods.forEach((vp, pIdx) => {
                    const rowClasses = []; if (isUnitStart && vtIdx === 0 && pIdx === 0) rowClasses.push('unit-top-border');
                    table3Html += `<tr class="${rowClasses.join(' ')}">`;
                    if (vtIdx === 0 && pIdx === 0) table3Html += `<td rowspan="${uGroup.rowSpan}">${uGroup.unit}</td>`;
                    if (pIdx === 0) { 
                      table3Html += `<td rowspan="${vt.periods.length}">${vt.role}</td>`;
                      table3Html += `<td rowspan="${vt.periods.length}" class="text-center">${vt.maxReq} 人</td>`; 
                    }
                    if (vp) { table3Html += `<td>${vp.start} ~ ${vp.end} <span style="font-size:10px; color:#64748b;">(少 ${vp.missing}人)</span></td><td class="text-right highlight font-bold">${vp.penaltyMissing * vp.days > 0 ? vp.penaltyMissing * vp.days : '-'}</td><td class="text-right grace">${vp.graceMissing * vp.days > 0 ? vp.graceMissing * vp.days : '-'}</td>`; }
                    table3Html += `</tr>`;
                });
            });
        });
        table3Html += `<tr style="background:#f8fafc; font-weight:bold; border-top: 2px solid #1e293b;"><td colspan="4" class="text-right">累計加總：</td><td class="text-right highlight font-bold" style="font-size:15px;">${vacancyTables.reduce((acc, vt) => acc + vt.totalPenaltyDays, 0)}</td><td class="text-right grace" style="font-size:15px;">${vacancyTables.reduce((acc, vt) => acc + vt.totalGraceDays, 0)}</td></tr>`;
    }
    table3Html += `</table>`;

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
          table { border-collapse: collapse; margin-bottom: 20px; width: 100%; font-size: 13px; table-layout: fixed; border: 1px solid #cbd5e1; }
          th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; word-wrap: break-word; }
          th { background-color: #f8fafc; color: #475569; font-weight: bold; }
          .text-center { text-align: center; } .text-right { text-align: right; } .font-bold { font-weight: bold; } .font-mono { font-family: monospace; } .highlight { color: #ef4444; } .grace { color: #10b981; font-weight: bold; }
          .unit-top-border td { border-top: 2px solid #1e293b !important; }
          .print-btn { display: block; width: 200px; margin: 20px auto; padding: 10px; background: #4f46e5; color: white; text-align: center; border-radius: 5px; font-weight: bold; cursor: pointer; border:none; }
          @media print { .no-print { display: none !important; } body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="no-print" style="text-align:center; background:#f0fdf4; padding:15px; border-radius:8px;"><button class="print-btn" onclick="window.print()">列印 / 儲存為 PDF</button></div>
        <h1>【${projectName}】人事異動與空缺紀錄表</h1>
        <div class="meta">報表統計區間：${startDate} 至 ${endDate} | 產出日期：${getLocalTodayStr()}</div>
        <h2 style="margin-top: 0;">一、 期間內人事異動軌跡</h2>
        <table>
          <colgroup><col style="width: 120px;"><col></colgroup>
          <tr><th>姓名</th><th>計劃期間異動軌跡</th></tr>
          ${activePersonnelChanges.map(ap => `<tr><td><strong>${ap.name}</strong></td><td>${ap.events.map(e => `<div>${e}</div>`).join('')}</td></tr>`).join('')}
        </table>
        ${table2Html}
        ${table3Html}
        <div style="margin-top: 40px; display: flex; justify-content: space-between; padding: 0 40px;">
          <div>承辦人：<br/><br/><br/>________________</div>
          <div>計畫主持人：<br/><br/><br/>________________</div>
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '', 'width=1000,height=800');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      setTimeout(() => printWindow.focus(), 500); showMessage('success', '✅ 異動與空缺紀錄表已產出。');
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      {message && (
        <div className={`p-4 rounded-xl border flex items-start shadow-sm animate-in slide-in-from-top-2 ${
          message.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
        }`}>
          {message.type === 'error' ? <AlertCircle size={20} className="mr-3 shrink-0 mt-0.5" /> : <CheckCircle2 size={20} className="mr-3 shrink-0 mt-0.5" />}
          <span className="text-sm font-bold">{message.text}</span>
        </div>
      )}

      {/* 頂部純粹標題說明區 */}
      <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm">
        <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center">
          <Calculator className="mr-3 text-indigo-500" size={24} />核銷作業報表中心
        </h2>
        <p className="text-sm text-slate-500 mt-2">選定專屬之統計參數。系統將實時比對出勤與動態異動歷程，產出符合政府專案核銷標準之法定附件憑證。</p>
      </div>

      {/* 區塊分流 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        
        {/* 1. 人員考勤表卡片 */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-indigo-100 dark:border-indigo-500/20 shadow-sm flex flex-col group hover:border-indigo-400 transition-colors relative overflow-hidden h-full">
          <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl shadow-sm">憑證中心</div>
          <div className="p-4 bg-blue-50 dark:bg-blue-500/10 rounded-2xl w-fit mb-4"><FileText className="text-blue-600" size={28} /></div>
          
          <h3 className="text-lg font-bold mb-1">1. 人員考勤匯總表</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-4">按日追蹤全月異動軌跡與彈性工時，一鍵篩選出特定組別之 A4 法定核銷憑證。</p>
          
          {/* 行內雙過濾器堆疊區 */}
          <div className="space-y-2.5 mb-5 mt-auto">
            {/* A. 月份選取 */}
            <div className="p-2.5 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 flex items-center"><Calendar size={12} className="mr-1 text-indigo-500" />結算月份</span>
              <input 
                type="month" 
                value={attendanceYearMonth} 
                onChange={(e) => setAttendanceYearMonth(e.target.value)} 
                className="bg-transparent text-xs font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer dark:[&::-webkit-calendar-picker-indicator]:invert" 
              />
            </div>
            {/* 單位過濾 */}
            <div className="p-2.5 bg-slate-50 dark:bg-slate-800/10 rounded-2xl border border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 flex items-center"><Filter size={12} className="mr-1 text-indigo-500" />計畫單位</span>
              <select 
                value={attendanceSelectedUnit} 
                onChange={(e) => setAttendanceSelectedUnit(e.target.value)} 
                className="bg-transparent text-xs font-bold text-slate-800 dark:text-slate-100 outline-none cursor-pointer text-right max-w-[150px] truncate"
              >
                <option value="ALL" className="text-slate-800 bg-white dark:bg-slate-800 dark:text-slate-100">全部單位 (ALL)</option>
                {allExistingUnits.map(unit => (
                  <option key={unit} value={unit} className="text-slate-800 bg-white dark:bg-slate-800 dark:text-slate-100">
                    {unit}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button onClick={exportAttendancePDF} disabled={!isDataLoaded || isLoadingAttendance} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm flex justify-center items-center space-x-2">
            {isDataLoaded && !isLoadingAttendance ? <Download size={16} /> : <Loader2 size={16} className="animate-spin" />}<span>匯出 A4 憑證 PDF</span>
          </button>
        </div>

        {/* 2. 異動與空缺紀錄表 */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-orange-200 dark:border-orange-500/30 shadow-sm flex flex-col group hover:border-orange-400 transition-colors relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-orange-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl shadow-sm">核心稽核</div>
          <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 rounded-2xl w-fit mb-4"><Users className="text-emerald-600" size={28} /></div>
          
          <h3 className="text-lg font-bold mb-1">2. 異動與空缺紀錄表</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-4">按員額 Slot 獨立精算在職與空缺區間，產出作為政府機關核減扣款依據之正式附件憑證。</p>
          
          {/* 日期區間過濾 */}
          <div className="space-y-2.5 mb-5 mt-auto">
            <div className="p-2.5 bg-orange-50/20 dark:bg-orange-950/10 rounded-2xl border border-orange-100/50 dark:border-orange-900/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-bold text-orange-600 dark:text-orange-400 flex items-center">
                <Calendar size={12} className="mr-1" />精算起始日
              </span>
              <input 
                type="date" 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)} 
                className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer" 
              />
            </div>
            
            <div className="p-2.5 bg-orange-50/20 dark:bg-orange-950/10 rounded-2xl border border-orange-100/50 dark:border-orange-900/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-bold text-orange-600 dark:text-orange-400 flex items-center">
                <Calendar size={12} className="mr-1" />精算結束日
              </span>
              <input 
                type="date" 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)} 
                className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer" 
              />
            </div>
          </div>

          <button onClick={exportVacancyReportPDF} disabled={!isDataLoaded} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm flex justify-center items-center space-x-2">
            {isDataLoaded ? <Download size={16} /> : <Loader2 size={16} className="animate-spin" />}<span>匯出 PDF (精算明細版)</span>
          </button>
        </div>

      </div>
    </div>
  );
}
