import React from 'react';
import { Upload, FolderArchive, Folder } from 'lucide-react';

export default function ArchiveModule() {
  const mockFolders = [
    { name: '1. 會議紀錄', count: 12 }, { name: '2. 公文與發文', count: 8 }, 
    { name: '3. 核銷單據與憑證', count: 45 }, { name: '4. 期中期末報告', count: 2 }
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center mb-4"><Upload className="mr-2 text-indigo-500" />檔案上傳與自動歸檔</h2>
        <div className="mb-6 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100">
          <label className="block text-sm font-medium mb-2">Step 1: 選擇歸檔目標目錄</label>
          <select className="w-full bg-white dark:bg-slate-800 border border-slate-300 text-sm rounded-lg p-2.5 outline-none">
            <option value="">-- 請選擇文件類別 --</option>
            {mockFolders.map((f, i) => <option key={i} value={f.name}>{f.name}</option>)}
          </select>
        </div>
        <div className="border-2 border-dashed border-slate-300 rounded-xl p-10 flex flex-col items-center cursor-pointer hover:bg-slate-50 transition-colors">
          <FolderArchive size={32} className="text-indigo-500 mb-3" />
          <p className="text-base font-medium">Step 2: 點擊或拖曳檔案至此</p>
          <p className="text-sm text-slate-500 mt-1">系統將自動套用標準檔名並同步至 Google Drive</p>
        </div>
      </div>
    </div>
  );
}
