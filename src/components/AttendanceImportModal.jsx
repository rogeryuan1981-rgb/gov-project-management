import React, { useState } from 'react';
import { collection, doc, writeBatch, getFirestore } from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { AlertCircle, Upload, CheckCircle2, FileWarning } from 'lucide-react';

const db = getFirestore(getApps().length === 0 ? initializeApp(typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {}) : getApp());
const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

export default function AttendanceImporter({ selectedProject, onImportSuccess }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [importMessage, setImportMessage] = useState(null);

  const showMsg = (type, text) => {
    setImportMessage({ type, text });
  };

  // 🔄 核心輔助：將 Excel 轉出的時間浮點數 (如 0.35416) 安全還原為 "HH:mm" 字串
  const excelSerialToTimeStr = (serial) => {
    const num = parseFloat(serial);
    if (isNaN(num)) return null;
    
    // Excel 的整數代表天數，小數點代表一天中的比例
    const totalSeconds = Math.round((num % 1) * 24 * 60 * 60);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  };

  // 🔄 核心輔助：清洗可能帶有日期的打卡時間字串 (如 "1899-12-30 08:30:00" 或 "08:30:22")
  const cleanTimeFormat = (rawStr) => {
    if (!rawStr) return "";
    let str = String(rawStr).trim();
    if (!str || str === '--' || str === 'null' || str === 'undefined') return "";

    // 1. 處理 Excel 數字型時間格式 (例如 0.354166666666667)
    if (/^\d?\.?\d+$/.test(str) && parseFloat(str) < 1) {
      const restored = excelSerialToTimeStr(str);
      if (restored) return restored;
    }

    // 2. 處理包含年月日與長時間格式 (例如 1899-12-30 08:30:00 或 2026/06/10 17:30)
    const timeMatch = str.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
    if (timeMatch) {
      const hh = String(timeMatch[1]).padStart(2, '0');
      const mm = String(timeMatch[2]).padStart(2, '0');
      return `${hh}:${mm}`;
    }

    return str; // 無法被自動排除並修正的，保留原樣交由後續校驗防線攔截
  };

  // 🔄 核心輔助：驗證是否為標準的 "HH:mm" 格式
  const isValidTimeStr = (str) => {
    if (!str) return true; // 空值代表沒打卡，屬於正常現象
    return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(str);
  };

  // 🚀 執行讀取 Excel / CSV 陣列資料並進行嚴格防卡控清洗與儲存
  const processAndSaveAttendance = async (rawJsonRows) => {
    if (!selectedProject) return showMsg('error', '請先選擇要匯入的專案。');
    if (!rawJsonRows || rawJsonRows.length === 0) return showMsg('error', '未偵測到任何有效的打卡數據。');

    setIsProcessing(true);
    setImportMessage(null);

    const errorLogs = [];
    const cleanedRecords = [];

    //  第一階段：逐筆進行標準化清洗與「不讓存入」之嚴格校驗防線
    for (let i = 0; i < rawJsonRows.length; i++) {
      const row = rawJsonRows[i];
      const rowNum = i + 2; // 對齊 Excel 實體行數（扣除標題列）

      const employeeName = row.name || row['姓名'] || '';
      const recordDate = row.date || row['日期'] || '';

      if (!employeeName) {
        errorLogs.push(`第 ${rowNum} 行：缺少【姓名】欄位。`);
        continue;
      }
      if (!recordDate) {
        errorLogs.push(`第 ${rowNum} 行 (${employeeName})：缺少【日期】欄位。`);
        continue;
      }

      // 自動排除範圍內的格式問題並進行修正清洗
      const rawCheckIn = row.checkIn || row['上班時間'] || '';
      const rawCheckOut = row.checkOut || row['下班時間'] || '';
      
      const cleanCheckIn = cleanTimeFormat(rawCheckIn);
      const cleanCheckOut = cleanTimeFormat(rawCheckOut);

      // 🛑 驗證防線一：檢查上班與下班時間是否符合標準 HH:mm 格式
      if (!isValidTimeStr(cleanCheckIn)) {
        errorLogs.push(`⚠️ ${employeeName} 在 ${recordDate} 的 [上班時間] 格式錯誤 (輸入值: "${rawCheckIn}")，無法正確解析。`);
      }
      if (!isValidTimeStr(cleanCheckOut)) {
        errorLogs.push(`⚠️ ${employeeName} 在 ${recordDate} 的 [下班時間] 格式錯誤 (輸入值: "${rawCheckOut}")，無法正確解析。`);
      }

      // 欄位整合預處理 (比對正規請假格式)
      const rawLeaveType = row.leaveType || row['假別'] || '';
      const rawLeaveRange = row.leaveRangeInfo || row['請假時間區間'] || '';
      const rawLeaveHours = row.parsedLeaveHours || row['請假時數'] || 0;

      const isLeave = !!(rawLeaveType && String(rawLeaveType).trim());
      const parsedLeaveHours = parseInt(rawLeaveHours, 10) || 0;

      // 🛑 驗證防線二：若有請假，檢查時數是否未確實維護（超出排除範圍的其他問題）
      if (isLeave && parsedLeaveHours <= 0) {
        errorLogs.push(`❌ ${employeeName} 在 ${recordDate} 登錄了 [${rawLeaveType}]，但其 [請假時數] 為空或為 0 小時，屬於未正確維護之異常。`);
      }

      // 通過校驗後，封裝成最乾淨且結構統一的封包
      if (errorLogs.length === 0) {
        // 推導該條紀錄所屬月份 (格式: YYYY-MM)
        let determinedMonth = "";
        if (recordDate.includes('-')) {
          determinedMonth = recordDate.substring(0, 7);
        } else if (recordDate.includes('/')) {
          const parts = recordDate.split('/');
          if (parts[0].length === 4) {
            determinedMonth = `${parts[0]}-${String(parts[1]).padStart(2, '0')}`;
          }
        }

        cleanedRecords.push({
          projectId: selectedProject,
          name: employeeName.trim(),
          date: recordDate.trim(),
          month: determinedMonth,
          checkIn: cleanCheckIn,
          checkOut: cleanCheckOut,
          isLeave: isLeave,
          parsedLeaveType: isLeave ? String(rawLeaveType).trim() : "",
          parsedLeaveHours: parsedLeaveHours,
          leaveRangeInfo: rawLeaveRange ? String(rawLeaveRange).trim() : "",
          proxySegments: row.proxySegments || [],
          updatedAt: new Date().toISOString()
        });
      }
    }

    // 第二階段：判定是否允許存入 Firestore
    if (errorLogs.length > 0) {
      setIsProcessing(false);
      // 串接成完整的警示字串，嚴格禁止寫入資料庫
      return showMsg('error', (
        <div className="space-y-2">
          <p className="font-black text-red-600">🚨 匯入檔案包含非預期錯誤，已全面禁止存入資料庫！請修正以下同仁之格式問題：</p>
          <ul className="list-disc pl-5 space-y-1 text-xs font-mono max-h-60 overflow-y-auto bg-white p-3 rounded-xl border border-red-200">
            {errorLogs.map((log, idx) => <li key={idx} className="text-red-700">{log}</li>)}
          </ul>
        </div>
      ));
    }

    // 第三階段：全面通過，執行高效率 Batch 批次寫入
    try {
      const batch = writeBatch(db);
      
      cleanedRecords.forEach(record => {
        // 使用 專案ID_姓名_日期 作為唯一定址 Key，避免重複寫入
        const docId = `${record.projectId}_${record.name}_${record.date}`;
        const docRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'attendance_records', docId);
        batch.set(docRef, record, { merge: true });
      });

      await batch.commit();
      showMsg('success', `🎉 全數查核通過！已成功清洗並無誤導入 ${cleanedRecords.length} 筆正規化考勤紀錄。`);
      
      if (typeof onImportSuccess === 'function') {
        onImportSuccess();
      }
    } catch (err) {
      console.error("批次匯入考勤發生致命崩潰:", err);
      showMsg('error', '儲存至雲端資料庫時發生通訊錯誤，請確認網路與權限。');
    } finally {
      setIsProcessing(false);
    }
  };

  // 本組件僅封裝核心清洗邏輯，您可以將此處綁定在您的檔案上傳按鈕 (如 Reader.onload)
  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-base font-bold text-slate-800 dark:text-white flex items-center">
          <Upload className="text-indigo-500 mr-2" size={18} /> Excel 考勤數據清洗匯入核心
        </h4>
      </div>

      {importMessage && (
        <div className={`p-4 mb-4 rounded-2xl border ${
          importMessage.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          <div className="text-sm font-medium">{importMessage.text}</div>
        </div>
      )}

      <p className="text-xs text-slate-400 leading-relaxed">
        💡 系統防呆已就緒：Excel 產出的時間浮點數（如 0.354）或帶有日期的字串會被自動修復還原；若出現非標準時間或請假時數漏填，將即刻中斷並回報人員姓名與日期。
      </p>
    </div>
  );
}
