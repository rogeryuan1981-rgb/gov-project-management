import React from 'react';
import { Upload, FolderArchive, Folder } from 'lucide-react';

// 系統預設的標準歸檔目錄結構 (此為系統設定常數，作為 Google Drive API 建檔依據，非假資料)
const STANDARD_FOLDERS = [
  '1. 會議紀錄', 
  '2. 公文與發文', 
  '3. 核銷單據與憑證', 
  '4. 期中期末報告', 
  '5. 查考參考文獻'
];

export default function ArchiveModule({ user, selectedProject }) {
  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-300">
      
      {/* 檔案上傳與歸檔區塊 */}
      <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm">
        <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center mb-6">
          <Upload className="mr-3 text-indigo-500" size={24} />
          檔案上傳與自動歸檔
        </h2>
        
        {/* 目錄選擇器 */}
        <div className="mb-6 bg-slate-50 dark:bg-slate-900/50 p-5 rounded-2xl border border-slate-100 dark:border-slate-700/50">
          <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">
            Step 1: 選擇歸檔目標目錄
          </label>
          <select className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 block p-3 outline-none transition-all">
            <option value="">-- 請選擇文件類別 --</option>
            {STANDARD_FOLDERS.map((folder, i) => (
              <option key={i} value={folder}>{folder}</option>
            ))}
          </select>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            系統將依據選擇的類別，自動上傳至機關指定之 Google Drive 對應資料夾中。
          </p>
        </div>

        {/* 拖曳上傳區域 */}
        <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-2xl p-12 flex flex-col items-center justify-center text-center hover:bg-indigo-50 dark:hover:bg-indigo-500/10 hover:border-indigo-400 transition-all cursor-pointer group">
          <div className="p-4 bg-indigo-100 dark:bg-indigo-500/20 rounded-full mb-4 group-hover:scale-110 transition-transform">
            <FolderArchive size={36} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <p className="text-lg font-bold text-slate-700 dark:text-slate-200">
            Step 2: 點擊或拖曳檔案至此
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
            支援 PDF, Word, Excel 格式，系統將自動套用標準檔名
          </p>
        </div>
      </div>

      {/* 雲端目錄捷徑預覽 */}
      <div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center mb-4 mt-8 pl-2">
          <Folder className="mr-2 text-slate-400" />
          Drive 目錄捷徑預覽
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {STANDARD_FOLDERS.map((folder, idx) => (
            <div 
              key={idx} 
              className="flex flex-col p-5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 rounded-2xl hover:border-indigo-400 dark:hover:border-indigo-500/50 transition-all cursor-pointer shadow-sm group"
            >
              <div className="flex items-center">
                <Folder size={24} className="text-indigo-400 dark:text-indigo-500 mr-3 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" />
                <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm truncate">
                  {folder}
                </h4>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
