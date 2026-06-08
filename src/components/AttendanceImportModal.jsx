import React, { useState } from 'react';
import { X, Upload, Download, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
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

  // ================= 1. 下載範本功能 (同步美化範本預期導出檔名與格式說明) =================
  const handleDownloadTemplate = () => {
    let csvContent = "";
    let fileName = "";

    if (importType === 'A') {
      csvContent = "\uFEFF員工編號,姓名,部門,打卡日期,上班打卡時間,,,,,,,,,下班打卡時間,,,,,,,,,,,請假時間,,,,請假時數,假別\n" +
                   "00,于家源,預防保健專案辦公室,2026/05/20,08:34,,,,,,,,,18:24,,,,,,,,,,,,,,,,,\n" +
                   "00,于家源,預防保健專案辦公室,2026/05/29,08:38,,,,,,,,,16:45,,,,,,,,,,,16:38~17:38,,,,01:00:00,特休";
      fileName = `專案辦公室範本_${selectedMonth}.csv`;
    } else {
      csvContent = "\uFEFFColumn1,Column2,Column3,Column4,Column5,Column6,Column7,Column8,Column9\n" +
                   "出退勤日期,姓名：江婉茜,,到勤時間,退勤時間,差假狀況,,假別,狀況註記\n" +
                   "115/04/01,職  稱：廠商駐點,,08:01,18:11,,,,,\n" +
                   "115/04/08,,,12:40,18:03,115/04/08 08:30 - 115/04/08 12:30,,喪假(祖父),";
      fileName = `駐點單位範本_${selectedMonth}.csv`;
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
  };

  // ================= 2. 核心解析 CSV 引擎 (含狀態機防移位) =================
  const parseCSVRows = (text) => {
    const lines = text.split(/\r?\n/);
    return lines
      .map(line => {
        const result = [];
        let currentCell = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(currentCell.trim().replace(/^"|"$/g, ''));
            currentCell = '';
          } else {
            currentCell += char;
          }
        }
        result.push(currentCell.trim().replace(/^"|"$/g, ''));
        return result;
      })
      .filter(cols => cols.length > 0 && cols.some(c => c !== ''));
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadStatus(null);

    try {
      const text = await file.text();
      const rawRows = parseCSVRows(text);

      if (rawRows.length <= 1) {
        throw new Error('檔案內無足夠的資料列');
      }

      const attendanceRef = collection(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'attendance_records');
      let successCount = 0;
      let skippedCount = 0;

      const sanitizeName = (str) => str ? str.toString().replace(/\s+/g, '').trim() : '';

      // ----------------------------------------------------
      // 【分流 A】新版考勤表 A (專案辦公室)
      // ----------------------------------------------------
      if (importType === 'A') {
        const header = rawRows[0];
        const nameIdx = header.indexOf('姓名') !== -1 ? header.indexOf('姓名') : 1;
        const dateIdx = header.indexOf('打卡日期') !== -1 ? header.indexOf('打卡日期') : 3;
        const inIdx = header.indexOf('上班打卡時間') !== -1 ? header.indexOf('上班打卡時間') : 12;
        const outIdx = header.indexOf('下班打卡時間') !== -1 ? header.indexOf('下班打卡時間') : 14;
        const leaveTimeIdx = 25;
        const leaveTypeIdx = 27;

        for (let i = 1; i < rawRows.length; i++) {
          const cols = rawRows[i];
          if (cols.length <= Math.max(nameIdx, dateIdx)) continue;

          const name = sanitizeName(cols[nameIdx]);
          const rawDate = cols[dateIdx]; 

          if (!name || !rawDate || !rawDate.replace(/\//g, '-').startsWith(selectedMonth)) continue;

          const dateStr = rawDate.replace(/\//g, '-');
          const checkIn = cols[inIdx] || "";
          const checkOut = cols[outIdx] || "";
          const leaveTime = cols[leaveTimeIdx] || "";
          const leaveType = cols[leaveTypeIdx] || "";

          const docId = `${selectedProject}_${name}_${dateStr}`;
          const docRef = doc(attendanceRef, docId);

          // 💡 【核心特赦防蓋邏輯】：寫入前先調閱文件，若含有人工維護標記，直接跳過全面保護！
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
            leaveRangeInfo: leaveTime === '--' ? '' : leaveTime, 
            leaveType: leaveType === '--' ? '' : leaveType,
            recordType: 'A_V2_TRACK'
          }, { merge: true });

          successCount++;
        }
        setStatusMessage(`[新版A表 - 專案辦公室] 匯入成功！成功覆蓋補進 ${successCount} 筆新流水號，並完美特赦保護了 ${skippedCount} 筆人工手動補登紀錄。`);
      }

      // ----------------------------------------------------
      // 【分流 C】考勤表 C (駐點單位多人員歷程比對與過濾)
      // ----------------------------------------------------
      else if (importType === 'C') {
        let currentEmployeeName = "";
        const importedNamesInFile = new Set(); // 記錄本檔案中有涉及考勤的人名
        let minFileDateMs = Infinity;
        let maxFileDateMs = -Infinity;
        
        for (let i = 0; i < rawRows.length; i++) {
          const cols = rawRows[i];
          if (cols.length < 2) continue;

          // B欄固定姓名欄位識別
          const nameField = cols[1] || "";
          if (nameField.includes('名：')) {
            currentEmployeeName = sanitizeName(nameField.split('名：')[1]);
            continue; 
          }

          const rawDate = cols[0];
          // 驗證 A欄是否為日期格式 115/04/01
          if (rawDate && /^\d{3}\/\d{2}\/\d{2}$/.test(rawDate)) {
            if (!currentEmployeeName) continue; 

            const checkIn = cols[3] || "";   // C欄
            const checkOut = cols[4] || "";  // D欄
            const leaveInfo = cols[5] || "";  // E欄
            const leaveType = cols[7] || "";  // F欄

            // 🎯 當日刷卡紀錄皆為空 且 沒有任何請假紀錄的資料列則跳過不匯入
            if (!checkIn.trim() && !checkOut.trim() && !leaveInfo.trim() && !leaveType.trim()) {
              continue;
            }

            const dateParts = rawDate.split('/');
            const westernYear = parseInt(dateParts[0], 10) + 1911;
            const dateStr = `${westernYear}-${dateParts[1]}-${dateParts[2]}`;

            // 動態統計本次考勤表所涵蓋的實際最小與最大日期
            const currentMs = new Date(dateStr).getTime();
            if (currentMs < minFileDateMs) minFileDateMs = currentMs;
            if (currentMs > maxFileDateMs) maxFileDateMs = currentMs;

            importedNamesInFile.add(currentEmployeeName);

            const docId = `${selectedProject}_${currentEmployeeName}_${dateStr}`;
            const docRef = doc(attendanceRef, docId);

            // 特赦防蓋邏輯
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
              recordType: 'C_TRACK'
            }, { merge: true });

            successCount++;
          }
        }

        // 🎯 依據人事模組存的人員職務轉任歷程，判斷缺失的考勤並提醒用戶
        let warningMessage = "";
        try {
          const hrRef = collection(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'personnel');
          const hrSnap = await getDocs(hrRef);
          const projectPersonnel = hrSnap.docs
            .map(doc => doc.data())
            .filter(p => p.projectId === selectedProject && p.isResident === true);

          const missingAlerts = [];

          // 確定要比對的區間範圍
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
            warningMessage = `\n\n【🚨 發現人員歷程空缺提示】\n系統比對人事模組歷程後，發現下列在職駐點人員完全缺少此期間之考勤資料，請確認是否漏匯：\n` + missingAlerts.join('\n');
          }
        } catch (hrError) {
          console.error("比對人事模組空缺時發生錯誤:", hrError);
        }

        setStatusMessage(`[考勤表C - 駐點單位] 匯入完成！成功補充 ${successCount} 筆明細，並安全隔離保護了 ${skippedCount} 筆人工維護紀錄。${warningMessage}`);
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
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">下載對應之標準格式範本</label>
            <button 
              onClick={handleDownloadTemplate}
              className="flex items-center space-x-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 w-full justify-center rounded-xl transition-colors text-xs font-bold border border-slate-200 dark:border-slate-600"
            >
              <Download size={14} className="text-indigo-500" />
              <span>下載結構範本 (.csv)</span>
            </button>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">選擇檔案上傳</label>
            {/* 💡 修正處：將原本的 accept=".csv" 修改為 accept=".xlsx, .xls" 以引導彈出 Excel 檔案格式選擇 */}
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
                  <span className="text-[10px] text-slate-400">系統將支援多頁籤人員識別並特赦保護人工欄位</span>
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
