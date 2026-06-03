import React, { useState } from 'react';
import { X, Upload, Download, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { doc, setDoc, getFirestore, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const db = getFirestore(getApp());

export default function AttendanceImportModal({ isOpen, onClose, selectedProject, projectName }) {
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7));
  const [importType, setImportType] = useState('AB'); // 'AB' = A+B組, 'C' = C組
  const [fileType, setFileType] = useState('A'); // 如果是 AB組，區分 'A' (打卡) 或 'B' (請假)
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null); // 'success' | 'error' | null
  const [statusMessage, setStatusMessage] = useState('');

  if (!isOpen) return null;

  // ================= 1. 下載範本功能 =================
  const handleDownloadTemplate = () => {
    let csvContent = "";
    let fileName = "";

    if (importType === 'AB') {
      if (fileType === 'A') {
        csvContent = "\uFEFF員工編號,姓名,部門,打卡日期,日期類別,班別,上班打卡,下班打卡,紀錄備註\n" +
                     "00,于家源,預防保健專案辦公室,2026/05/20,平日,固定班,08:34,--,\n" +
                     "00,于家源,預防保健專案辦公室,2026/05/20,平日,固定班,--,18:24,";
        fileName = `考勤表A_打卡範本_${selectedMonth}.csv`;
      } else {
        csvContent = "\uFEFF員工編號,員工姓名,部門,申請單日期,請假開始日期,請假開始時間,請假結束日期,請假結束時間,請假時數,假別\n" +
                     "00,于家源,預防保健專案辦公室,2026/06/02 09:08,2026/05/29,16:38,2026/05/29,17:38,1.0,特休\n" +
                     "04,彭柔銨,預防保健專案辦公室,2026/05/20 10:02,2026/05/26,08:30,2026/05/29,17:30,32.0,特休";
        fileName = `考勤表B_請假範本_${selectedMonth}.csv`;
      }
    } else {
      csvContent = "\uFEFFColumn1,Column2,Column3,Column4,Column5,Column6,Column7,Column8,Column9\n" +
                   "出退勤日期,姓名：江婉茜,,到勤時間,退勤時間,差假狀況,,假別,狀況註記\n" +
                   "115/04/01,職　　稱：廠商駐點,,08:01,18:11,,,,,\n" +
                   "115/04/08,,,12:40,18:03,115/04/08 08:30 - 115/04/08 12:30,,喪假(祖父),";
      fileName = `考勤表C_一體化範本_${selectedMonth}.csv`;
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
  };

  // ================= 2. 核心解析 CSV 引擎 =================
  const parseCSVRows = (text) => {
    // 處理換行符號，相容 Windows (\r\n) 與 Mac (\n)
    const lines = text.split(/\r?\n/);
    return lines
      .map(line => {
        // 簡易 CSV 欄位切分，去除欄位前後雙引號
        return line.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''));
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

      // ----------------------------------------------------
      // 【分流 A】考勤表 A：同人同日雙列聚合機制
      // ----------------------------------------------------
      if (importType === 'AB' && fileType === 'A') {
        const attendanceMap = {};
        // 尋找表頭欄位索引
        const header = rawRows[0];
        const nameIdx = header.indexOf('姓名');
        const dateIdx = header.indexOf('打卡日期');
        const inIdx = header.indexOf('上班打卡');
        const outIdx = header.indexOf('下班打卡');

        if (nameIdx === -1 || dateIdx === -1 || inIdx === -1 || outIdx === -1) {
          throw new Error('考勤表 A 格式不符，找不到必要欄位');
        }

        // 開始聚合
        for (let i = 1; i < rawRows.length; i++) {
          const cols = rawRows[i];
          if (cols.length <= Math.max(nameIdx, dateIdx, inIdx, outIdx)) continue;

          const name = cols[nameIdx];
          const rawDate = cols[dateIdx]; // YYYY/MM/DD
          if (!name || !rawDate || !rawDate.includes(selectedMonth.replace('-', '/'))) continue;

          const dateStr = rawDate.replace(/\//g, '-'); // 統一轉 YYYY-MM-DD
          const key = `${selectedProject}_${name}_${dateStr}`;

          if (!attendanceMap[key]) {
            attendanceMap[key] = {
              projectId: selectedProject,
              month: selectedMonth,
              name,
              date: dateStr,
              checkIn: '',
              checkOut: '',
              recordType: 'AB_TRACK'
            };
          }

          const clockIn = cols[inIdx];
          const clockOut = cols[outIdx];

          if (clockIn && clockIn !== '--') attendanceMap[key].checkIn = clockIn;
          if (clockOut && clockOut !== '--') attendanceMap[key].checkOut = clockOut;
        }

        // 寫入 Firestore (使用精準 ID 覆蓋)
        const entries = Object.entries(attendanceMap);
        for (const [docId, data] of entries) {
          await setDoc(doc(attendanceRef, docId), data, { merge: true });
          successCount++;
        }
        setStatusMessage(`[考勤表A] 匯入成功！共聚合並覆蓋 ${successCount} 天的出勤刷卡紀錄。`);
      }

      // ----------------------------------------------------
      // 【分流 B】考勤表 B：區間請假拆日展開沖銷機制
      // ----------------------------------------------------
      else if (importType === 'AB' && fileType === 'B') {
        const header = rawRows[0];
        const nameIdx = header.indexOf('員工姓名');
        const startDayIdx = header.indexOf('請假開始日期');
        const startTimeIdx = header.indexOf('請假開始時間');
        const endDayIdx = header.indexOf('請假結束日期');
        const endTimeIdx = header.indexOf('請假結束時間');
        const typeIdx = header.indexOf('假別');

        if (nameIdx === -1 || startDayIdx === -1 || startTimeIdx === -1 || endDayIdx === -1 || endTimeIdx === -1 || typeIdx === -1) {
          throw new Error('考勤表 B 格式不符，找不到必要欄位');
        }

        for (let i = 1; i < rawRows.length; i++) {
          const cols = rawRows[i];
          if (cols.length <= Math.max(nameIdx, startDayIdx, endDayIdx)) continue;

          const name = cols[nameIdx];
          const startDayStr = cols[startDayIdx].replace(/\//g, '-'); // YYYY-MM-DD
          const startTime = cols[startTimeIdx];
          const endDayStr = cols[endDayIdx].replace(/\//g, '-');   // YYYY-MM-DD
          const endTime = cols[endTimeIdx];
          const leaveType = cols[typeIdx];

          if (!name || !startDayStr || !endDayStr) continue;

          // 產生日期區間陣列，處理可能跨日的狀況
          let startMs = new Date(`${startDayStr} ${startTime || '08:00'}`).getTime();
          let endMs = new Date(`${endDayStr} ${endTime || '17:00'}`).getTime();
          
          let currentPtr = new Date(startDayStr);
          const endPtr = new Date(endDayStr);

          // 逐日展開填入資料
          while (currentPtr <= endPtr) {
            const dateStr = currentPtr.toISOString().split('T')[0];
            
            // 唯有屬於當前選擇月份的才匯入
            if (dateStr.startsWith(selectedMonth)) {
              const docId = `${selectedProject}_${name}_${dateStr}`;
              
              // 依據時間交集計算當天實際請假區間 (預設常態工時 08:00 至 17:00)
              let currentDayStart = `${dateStr} ${dateStr === startDayStr ? startTime : '08:00'}`;
              let currentDayEnd = `${dateStr} ${dateStr === endDayStr ? endTime : '17:00'}`;

              await setDoc(doc(attendanceRef, docId), {
                projectId: selectedProject,
                month: selectedMonth,
                name,
                date: dateStr,
                leaveStart: currentDayStart,
                leaveEnd: currentDayEnd,
                leaveType: leaveType,
                recordType: 'AB_TRACK'
              }, { merge: true });
              
              successCount++;
            }
            // 往後推一天
            currentPtr.setDate(currentPtr.getDate() + 1);
          }
        }
        setStatusMessage(`[考勤表B] 匯入成功！已將請假區間拆解至對應日，共部署 ${successCount} 筆請假沖銷紀錄。`);
      }

      // ----------------------------------------------------
      // 【分流 C】考勤表 C：民國曆轉換與一體化單列解析
      // ----------------------------------------------------
      else if (importType === 'C') {
        let currentEmployeeName = "";
        
        // 尋找 Column 的索引位置 (對應 A, B, D, E, F, H 欄)
        // A=0(日期), B=1(姓名格), D=3(到勤), E=4(退勤), F=5(差假), H=7(假別)
        for (let i = 0; i < rawRows.length; i++) {
          const cols = rawRows[i];
          if (cols.length < 2) continue;

          // 偵測並擷取 B 欄中的「姓名：江婉茜」
          const nameField = cols[1] || "";
          if (nameField.includes('名：')) {
            currentEmployeeName = nameField.split('名：')[1]?.trim() || "";
            continue; // 姓名列為表頭區，跳過此行資料解析
          }

          const rawDate = cols[0]; // A欄：出退勤日期 (格式如 115/04/01)
          // 檢查第一欄是否為民國曆格式的日期
          if (rawDate && /^\d{3}\/\d{2}\/\d{2}$/.test(rawDate)) {
            if (!currentEmployeeName) continue; // 防呆：必須先撈到姓名才處理

            // 民國曆轉西元曆 (115 + 1911 = 2026)
            const dateParts = rawDate.split('/');
            const westernYear = parseInt(dateParts[0], 10) + 1911;
            const dateStr = `${westernYear}-${dateParts[1]}-${dateParts[2]}`;

            const checkIn = cols[3] || "";  // D欄
            const checkOut = cols[4] || ""; // E欄
            const leaveInfo = cols[5] || ""; // F欄
            const leaveType = cols[7] || ""; // H欄

            const docId = `${selectedProject}_${currentEmployeeName}_${dateStr}`;

            await setDoc(doc(attendanceRef, docId), {
              projectId: selectedProject,
              month: dateStr.substring(0, 7), // 動態抓取轉換後的年月
              name: currentEmployeeName,
              date: dateStr,
              checkIn,
              checkOut,
              leaveRangeInfo: leaveInfo, // 儲存原始請假時間文字區間
              leaveType,
              recordType: 'C_TRACK'
            }, { merge: true });

            successCount++;
          }
        }
        setStatusMessage(`[考勤表C] 民國曆解析完成！成功一體化匯入 ${successCount} 筆出勤與請假明細。`);
      }

      setUploadStatus('success');
    } catch (error) {
      console.error("考勤匯入發生錯誤:", error);
      setUploadStatus('error');
      setStatusMessage(error.message || '檔案解析或上傳失敗，請檢查欄位格式。');
    } finally {
      setIsUploading(false);
      e.target.value = ''; // 清空 Input 檔案殘留
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
          {/* 1. 月份與組別分流選擇 */}
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
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">人員與考勤表組別</label>
              <select 
                value={importType} 
                onChange={(e) => setImportType(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="AB">A+B組 (打卡與請假分離)</option>
                <option value="C">C組 (單列一體化 / 駐點組)</option>
              </select>
            </div>
          </div>

          {/* 2. 當選擇 AB組時，需進一步切換要匯入打卡還是請假 */}
          {importType === 'AB' && (
            <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-400">目前匯入目標檔案：</span>
              <div className="flex space-x-2">
                <button 
                  type="button"
                  onClick={() => setFileType('A')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${fileType === 'A' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white dark:bg-slate-800 border text-slate-600 dark:text-slate-300'}`}
                >
                  考勤表 A (打卡數據)
                </button>
                <button 
                  type="button"
                  onClick={() => setFileType('B')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${fileType === 'B' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white dark:bg-slate-800 border text-slate-600 dark:text-slate-300'}`}
                >
                  考勤表 B (請假紀錄)
                </button>
              </div>
            </div>
          )}

          {/* 3. 範本下載 */}
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

          {/* 4. 上傳檔案區 */}
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">選擇檔案上傳 (重複上傳會自動精準覆蓋修正)</label>
            <label className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-2xl cursor-pointer transition-colors text-center ${isUploading ? 'bg-slate-50 border-slate-300 dark:bg-slate-900/30' : 'bg-white border-indigo-200 hover:border-indigo-400 dark:bg-slate-800/50 dark:border-slate-700 dark:hover:border-slate-500'}`}>
              <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} disabled={isUploading} />
              
              {isUploading ? (
                <div className="flex flex-col items-center space-y-2">
                  <Loader2 size={32} className="text-indigo-500 animate-spin" />
                  <span className="text-sm font-bold text-slate-600 dark:text-slate-400各軌道自動化對應演算法校對中...">系統正在自動執行格式轉換與校對...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center space-y-1.5">
                  <div className="p-3 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400"><Upload size={20} /></div>
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300">點擊選擇或拖放對應 CSV 報表</span>
                  <span className="text-[10px] text-slate-400">系統會根據選定組別與唯一金鑰自動覆蓋更新</span>
                </div>
              )}
            </label>
          </div>

          {/* 5. 狀態與警示訊息提示 */}
          {uploadStatus && (
            <div className={`p-4 rounded-xl border flex items-start text-xs ${uploadStatus === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400' : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400'}`}>
              {uploadStatus === 'success' ? <CheckCircle2 size={16} className="mr-2 shrink-0 mt-0.5" /> : <AlertCircle size={16} className="mr-2 shrink-0 mt-0.5" />}
              <div>
                <p className="font-bold">{uploadStatus === 'success' ? '數據導入及覆蓋校對完成' : '解析失敗'}</p>
                <p className="mt-0.5 opacity-90 leading-relaxed">{statusMessage}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 text-slate-600 dark:text-slate-300 text-sm font-bold hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors">
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
