import React, { useState } from 'react';
import { X, Upload, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { doc, setDoc, getDoc, getFirestore, collection, getDocs } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const db = getFirestore(getApp());

export default function AttendanceImportModal({ isOpen, onClose, selectedProject, projectName }) {
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7));
  const [importType, setImportType] = useState('A'); // 'A' = 新版A表, 'C' = C表
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null); // 'success' | 'error' | null
  const [statusMessage, setStatusMessage] = useState('');

  if (!isOpen) return null;

  // 運行時動態載入 CDN SheetJS 庫的方法，徹底解決 Rollup 無法 resolve "xlsx" 的 Vercel 編譯錯誤
  const loadSheetJS = () => {
    return new Promise((resolve, reject) => {
      if (window.XLSX) {
        resolve(window.XLSX);
        return;
      }
      const script = document.createElement('script');
      script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      script.onload = () => resolve(window.XLSX);
      script.onerror = (err) => reject(new Error("無法自動加載 Excel 解析套件，請檢查網路連線。"));
      document.body.appendChild(script);
    });
  };

  // 輔助預處理工具一：時間轉分鐘
  const timeToMinutes = (timeStr) => {
    if (!timeStr || !timeStr.includes(':')) return 0;
    const parts = timeStr.split(':');
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  };

  // 輔助預處理工具二：精算扣除中午休息(12:30-13:30)的有效請假時數
  const getEffectiveLeaveHours = (startStr, endStr) => {
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
    return Math.ceil(totalMinutes / 60);
  };

  // 輔助預處理工具三：專屬解析 Excel 內多元日期格式 (字串/西元/序數) 並標準化為 YYYY-MM-DD
  const formatExcelDate = (rawDate, XLSXLib) => {
    if (!rawDate) return "";
    let strDate = rawDate.toString().trim();
    
    // 如果是 Excel 的日期數字序數型態
    if (/^\d+(\.\d+)?$/.test(strDate)) {
      const dateObj = XLSXLib.SSF.parse_date_code(parseFloat(strDate));
      const y = dateObj.y;
      const m = String(dateObj.m).padStart(2, '0');
      const d = String(dateObj.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    
    // 如果是字串型態，統一將斜線取代為橫槓
    strDate = strDate.replace(/\//g, '-');
    
    // 補齊可能缺失的月份/日期前置零 (例如 2026-5-9 -> 2026-05-09)
    const parts = strDate.split('-');
    if (parts.length === 3) {
      const y = parts[0];
      const m = parts[1].padStart(2, '0');
      const d = parts[2].padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    
    return strDate;
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadStatus(null);

    try {
      const attendanceRef = collection(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'attendance_records');
      let successCount = 0;
      let skippedCount = 0;
      const sanitizeName = (str) => str ? str.toString().replace(/\s+/g, '').trim() : '';

      const XLSXLib = await loadSheetJS();
      const data = await file.arrayBuffer();
      const workbook = XLSXLib.read(data, { type: 'array' });

      // ----------------------------------------------------
      // 【分流 A】新版專案辦公室 - 升級一體化 Excel 解析與預處理清洗
      // ----------------------------------------------------
      if (importType === 'A') {
        let hasTimeDeductionWarning = false; // 用於標記當月是否含有非整天假，需要手動維護區間的提示

        // 遍歷所有頁籤，支援單一檔案內含有多個群組頁籤
        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          const sheetRows = XLSXLib.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

          // 固定依規格要求，自第二列（索引 1）開始解析實體資料
          for (let i = 1; i < sheetRows.length; i++) {
            const cols = sheetRows[i];
            if (!cols || cols.length === 0) continue;

            // 固定欄位映射
            const name = sanitizeName(cols[0]); // A欄
            const rawDate = cols[1];            // B欄
            let checkIn = cols[4] ? cols[4].toString().trim() : "";   // E欄
            let checkOut = cols[6] ? cols[6].toString().trim() : "";  // G欄
            let leaveText = cols[7] ? cols[7].toString().trim() : ""; // H欄

            // 🎯 核心規格防護：若 E、G、H 欄同時為空，視為垃圾資料，直接跳過不存入
            if (!checkIn && !checkOut && !leaveText) {
              continue;
            }

            // 格式化日期並校對月份
            const dateStr = formatExcelDate(rawDate, XLSXLib);
            if (!name || !dateStr || !dateStr.startsWith(selectedMonth)) continue;

            let parsedLeaveType = "";
            let parsedLeaveHours = 0;
            let isLeave = false;
            let leaveRangeInfo = "";

            // 正則抓取 H 欄假別
            const leaveMatch = leaveText.match(/(特休|事假|病假|生理假|喪假|公出|補休)/);
            if (leaveMatch) {
              parsedLeaveType = leaveMatch[1];
              isLeave = true;

              // 🎯 規格判定一：當日無上下班刷卡紀錄 且 假別欄位寫有「1天」或「一天」者
              if (!checkIn && !checkOut && (leaveText.includes('1天') || leaveText.includes('一天') || leaveText.includes('全天'))) {
                parsedLeaveHours = 8;
                leaveRangeInfo = "08:30 ~ 17:30"; // 自動全方位補全核銷法定區間
              } else {
                // 🎯 規格判定二：屬於小時假的範疇
                hasTimeDeductionWarning = true; // 啟動最末彈窗的輔助提醒

                // 試圖提煉字串內含有的數字小時數
                const hourMatch = leaveText.match(/(\d+(\.\d+)?)/);
                if (hourMatch && hourMatch[1]) {
                  parsedLeaveHours = Math.ceil(parseFloat(hourMatch[1]));
                } else if (leaveText.includes('半天') || leaveText.includes('4小時')) {
                  parsedLeaveHours = 4;
                } else {
                  parsedLeaveHours = 8; // 補底措施
                }
              }
            }

            const docId = `${selectedProject}_${name}_${dateStr}`;
            const docRef = doc(attendanceRef, docId);

            // 特赦保護：若人工手動調整過，系統不予強行覆蓋
            const docSnap = await getDoc(docRef);
            if (docSnap.exists() && docSnap.data().isManualMaintained === true) {
              skippedCount++;
              continue;
            }

            await setDoc(docRef, {
              projectId: selectedProject,
              month: selectedMonth,
              name: name, 
              date: dateStr,
              checkIn: checkIn === '--' ? '' : checkIn,
              checkOut: checkOut === '--' ? '' : checkOut,
              leaveRangeInfo: leaveRangeInfo, 
              leaveType: parsedLeaveType, // 入庫時同時填入原始清洗結果
              recordType: 'A_V2_TRACK',
              // 🚀 寫入一體化預處理欄位
              isLeave: isLeave,
              parsedLeaveType: parsedLeaveType,
              parsedLeaveHours: parsedLeaveHours
            }, { merge: true });

            successCount++;
          }
        }

        let hintNotice = "";
        if (hasTimeDeductionWarning) {
          hintNotice = `\n\n【💡 提示：本月含有非整天假紀錄】\n匯入資料中包含部分非整天（小時數）之差假事實，系統已自動洗滌出假別與純數字時數入庫。由於來源表無具體區間，**報表中心明細若需印出精確時間，請至打卡維護介面手動補充具體請假區間**。`;
        }

        setStatusMessage(`[新版A表 - 專案辦公室] Excel 一體化轉換導入成功！自第二列起共精算並預處理 ${successCount} 筆流水紀錄，特赦保護了 ${skippedCount} 筆手動維護資料。${hintNotice}`);
      }

      // ----------------------------------------------------
      // 【分流 C】考勤表 C (駐點單位 - 支援多頁籤、請整天假欄位左移相容)
      // ----------------------------------------------------
      else if (importType === 'C') {
        const importedNamesInFile = new Set(); 
        let minFileDateMs = Infinity;
        let maxFileDateMs = -Infinity;

        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          const sheetRows = XLSXLib.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
          
          let currentEmployeeName = "";

          for (let i = 0; i < sheetRows.length; i++) {
            const cols = sheetRows[i];
            if (!cols || cols.length < 2) continue;

            const nameField = cols[1] ? cols[1].toString() : "";
            if (nameField.includes('名：')) {
              currentEmployeeName = sanitizeName(nameField.split('名：')[1]);
              continue; 
            }

            const rawDate = cols[0] ? cols[0].toString().trim() : "";
            if (rawDate && /^\d{3}\/\d{2}\/\d{2}$/.test(rawDate)) {
              if (!currentEmployeeName) continue; 

              let checkIn = cols[2] ? cols[2].toString().trim() : "";   
              let checkOut = cols[3] ? cols[3].toString().trim() : "";  
              let leaveInfo = cols[4] ? cols[4].toString().trim() : ""; 
              let leaveType = cols[5] ? cols[5].toString().trim() : ""; 

              if (checkIn.includes(' - ') || (checkIn.includes('/') && checkIn.length > 10)) {
                leaveInfo = checkIn;  
                leaveType = checkOut; 
                checkIn = "";          
                checkOut = "";         
              }

              if (!checkIn && !checkOut && !leaveInfo && !leaveType) {
                continue;
              }

              const dateParts = rawDate.split('/');
              const westernYear = parseInt(dateParts[0], 10) + 1911;
              const dateStr = `${westernYear}-${dateParts[1]}-${dateParts[2]}`;

              const currentMs = new Date(dateStr).getTime();
              if (currentMs < minFileDateMs) minFileDateMs = currentMs;
              if (currentMs > maxFileDateMs) maxFileDateMs = currentMs;

              importedNamesInFile.add(currentEmployeeName);

              let parsedLeaveType = "";
              let parsedLeaveHours = 0;
              let isLeave = false;

              const leaveTargetString = `${leaveType || ''} ${leaveInfo || ''}`;
              const leaveMatch = leaveTargetString.match(/(特休|事假|病假|生理假|喪假|公出|補休)/);
              
              if (leaveMatch) {
                parsedLeaveType = leaveMatch[1];
                isLeave = true;

                if (leaveInfo && typeof leaveInfo === 'string') {
                  const formattedRange = leaveInfo.replace(/-/g, '~').replace(/\s+/g, '');
                  const timeMatch = formattedRange.match(/(\d{2}:\d{2})~(\d{2}:\d{2})/);
                  if (timeMatch && timeMatch[1] && timeMatch[2]) {
                    parsedLeaveHours = getEffectiveLeaveHours(timeMatch[1], timeMatch[2]);
                  } else if (formattedRange.includes('4小時') || formattedRange.includes('半天')) {
                    parsedLeaveHours = 4;
                  } else if (formattedRange.includes('8小時') || formattedRange.includes('全天')) {
                    parsedLeaveHours = 8;
                  }
                }

                if (parsedLeaveHours === 0) {
                  parsedLeaveHours = 8;
                }
              }

              const docId = `${selectedProject}_${currentEmployeeName}_${dateStr}`;
              const docRef = doc(attendanceRef, docId);

              const docSnap = await getDoc(docRef);
              if (docSnap.exists() && docSnap.data().isManualMaintained === true) {
                skippedCount++;
                continue;
              }

              await setDoc(docRef, {
                projectId: selectedProject,
                month: dateStr.substring(0, 7), 
                name: currentEmployeeName, 
                date: dateStr,
                checkIn,
                checkOut,
                leaveRangeInfo: leaveInfo, 
                leaveType,
                recordType: 'C_TRACK',
                isLeave: isLeave,
                parsedLeaveType: parsedLeaveType,
                parsedLeaveHours: parsedLeaveHours
              }, { merge: true });

              successCount++;
            }
          }
        }

        // 比對人事模組歷程，揪出駐點單位「缺了誰」
        let warningMessage = "";
        try {
          const hrRef = collection(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'personnel');
          const hrSnap = await getDocs(hrRef);
          const projectPersonnel = hrSnap.docs
            .map(doc => doc.data())
            .filter(p => p.projectId === selectedProject && p.isResident === true);

          const missingAlerts = [];
          let checkStartStr = `${selectedMonth}-01`;
          let checkEndStr = new Date(new Date(selectedMonth + "-01").getFullYear(), new Date(selectedMonth + "-01").getMonth() + 1, 0).toISOString().split('T')[0];
          
          if (minFileDateMs !== Infinity && maxFileDateMs !== -Infinity) {
            checkStartStr = new Date(minFileDateMs).toISOString().split('T')[0];
            checkEndStr = new Date(maxFileDateMs).toISOString().split('T')[0];
          }

          const checkStartMs = new Date(checkStartStr).getTime();
          const checkEndMs = new Date(checkEndStr).getTime();

          projectPersonnel.forEach(p => {
            if (!importedNamesInFile.has(p.name)) {
              let activeStartMs = null;
              let activeEndMs = null;

              const contractStartMs = p.contractStart ? new Date(p.contractStart).getTime() : 0;
              const contractEndMs = p.contractEnd ? (p.contractEnd === '至今' ? Infinity : new Date(p.contractEnd).getTime()) : Infinity;

              (p.history || []).forEach(h => {
                const historyStartMs = h.startDate ? new Date(h.startDate).getTime() : 0;
                const historyEndMs = h.endDate ? new Date(h.endDate).getTime() : Infinity;
                const realStartMs = Math.max(historyStartMs, contractStartMs);
                const realEndMs = Math.min(historyEndMs, contractEndMs);
                const overlapStartMs = Math.max(realStartMs, checkStartMs);
                const overlapEndMs = Math.min(realEndMs, checkEndMs);

                if (overlapStartMs <= overlapEndMs) {
                  if (!activeStartMs || overlapStartMs < activeStartMs) activeStartMs = overlapStartMs;
                  if (!activeEndMs || overlapEndMs > activeEndMs) activeEndMs = overlapEndMs;
                }
              });

              if (activeStartMs && activeEndMs) {
                const startStr = new Date(activeStartMs).toISOString().split('T')[0];
                const endStr = new Date(activeEndMs).toISOString().split('T')[0];
                missingAlerts.push(`⚠️ 【${p.name}】 缺少區間: ${startStr} ~ ${endStr}`);
              }
            }
          });

          if (missingAlerts.length > 0) {
            warningMessage = `\n\n【🚨 發現人員歷程空缺提示】\n系統比對人事模組歷程後，發現下列在職駐點人員完全缺少 Excel 中的考勤記錄：\n` + missingAlerts.join('\n');
          }
        } catch (hrError) {
          console.error("比對人事模組空缺時發生錯誤:", hrError);
        }

        setStatusMessage(`[考勤表C - 駐點單位] 匯入完成！成功從多頁籤中解析並補充 ${successCount} 筆明細，安全隔離保護了 ${skippedCount} 筆人工維護紀錄並自動相容整天請假位移。${warningMessage}`);
      }

      setUploadStatus('success');
    } catch (error) {
      console.error("考勤匯入發生錯誤:", error);
      setUploadStatus('error');
      setStatusMessage(error.message || '檔案解析或上傳失敗，請檢查欄位格式。');
    } finally {
      setIsUploading(false);
      if (e && e.target) {
        e.target.value = '';
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
          <div>
            <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center">
              <Upload size={20} className="mr-2 text-indigo-500" />匯入出勤紀錄
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">{projectName}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">結算月份</label>
              <input 
                type="month" 
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">考勤表格式類別</label>
              <select 
                value={importType} 
                onChange={(e) => setImportType(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-indigo-600 dark:text-indigo-400"
              >
                <option value="A">專案辦公室</option>
                <option value="C">駐點單位</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">選擇檔案上傳</label>
            <label className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-2xl cursor-pointer transition-colors text-center ${isUploading ? 'bg-slate-50 border-slate-300 dark:bg-slate-900/30' : 'bg-white border-indigo-200 hover:border-indigo-400 dark:bg-slate-800/50 dark:border-slate-700 dark:hover:border-slate-500'}`}>
              <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileChange} disabled={isUploading} />
              
              {isUploading ? (
                <div className="flex flex-col items-center space-y-2">
                  <Loader2 size={32} className="text-indigo-500 animate-spin" />
                  <span className="text-sm font-bold text-slate-600 dark:text-slate-400">系統正在執行一體化欄位對應與覆蓋...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center space-y-1.5">
                  <div className="p-3 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400"><Upload size={20} /></div>
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300">點擊選擇或拖放對應 Excel (.xlsx) 報表</span>
                  <span className="text-[10px] text-slate-400">系統將支援多頁籤人員識別並全自動清洗與相容特殊假別</span>
                </div>
              )}
            </label>
          </div>

          {uploadStatus && (
            <div className={`p-4 rounded-xl border flex items-start text-xs ${uploadStatus === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400' : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400'}`}>
              {uploadStatus === 'success' ? <CheckCircle2 size={16} className="mr-2 shrink-0 mt-0.5" /> : <AlertCircle size={16} className="mr-2 shrink-0 mt-0.5" />}
              <div>
                <p className="font-bold">{uploadStatus === 'success' ? '數據導入及覆蓋校對完成' : '解析失敗'}</p>
                <p className="mt-0.5 opacity-90 leading-relaxed whitespace-pre-line">{statusMessage}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 text-slate-600 dark:text-slate-300 text-sm font-bold hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors">
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
