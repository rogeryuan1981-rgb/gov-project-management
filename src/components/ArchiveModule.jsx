import React, { useState, useEffect } from 'react';
import { Upload, FolderArchive, Folder, ChevronRight, Loader2, CheckCircle2, AlertTriangle, FileUp } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

export default function ArchiveModule({ user, selectedProject }) {
  const [projectFolders, setProjectFolders] = useState([]);
  const [projectName, setProjectName] = useState(''); // 記錄顯示用的專案名稱
  const [dragActiveId, setDragActiveId] = useState(null);
  const [uploadingTo, setUploadingTo] = useState(null); // 記錄當前正在上傳的目錄 ID
  const [successMessage, setSuccessMessage] = useState('');

  // 監聽當前專案的目錄設定
  useEffect(() => {
    if (!user || !selectedProject) return;

    const projectsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'projects');
    const unsubscribe = onSnapshot(projectsRef, (snapshot) => {
      const loadedProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // 【修復】：改用專案專屬 UID (id) 進行精準比對
      const currentProject = loadedProjects.find(p => p.id === selectedProject);
      
      if (currentProject) {
        setProjectName(currentProject.name);
        // 若該專案有設定 folders 則寫入狀態，否則設為空陣列
        if (currentProject.folders) {
          setProjectFolders(currentProject.folders);
        } else {
          setProjectFolders([]);
        }
      }
    }, (error) => {
      console.error("讀取目錄設定失敗:", error);
    });

    return () => unsubscribe();
  }, [user, selectedProject]);

  // ================= 拖曳與上傳事件處理 =================
  const handleDragEnter = (e, folderId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActiveId(folderId);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActiveId(null);
  };

  const handleDragOver = (e, folderId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActiveId(folderId); // 確保在上方移動時持續保持 active 狀態
  };

  const handleDrop = (e, folder) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActiveId(null);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processUpload(folder, e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e, folder) => {
    if (e.target.files && e.target.files.length > 0) {
      processUpload(folder, e.target.files[0]);
    }
    e.target.value = ''; // 重置 input
  };

  const processUpload = (folder, file) => {
    setUploadingTo(folder.id);
    
    // 模擬 API 串接 Google Drive 的時間延遲
    setTimeout(() => {
      setUploadingTo(null);
      const targetPath = `${projectName} / ${folder.level1} ${folder.level2 ? `/ ${folder.level2}` : ''}`;
      setSuccessMessage(`✅ 檔案「${file.name}」已成功自動更名並歸檔至：\n${targetPath}`);
      
      // 5秒後清除成功訊息
      setTimeout(() => setSuccessMessage(''), 5000);
    }, 1500);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-300">
      
      <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 border-b border-slate-100 dark:border-slate-700/50 pb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center">
              <Upload className="mr-3 text-indigo-500" size={24} />
              直覺式拖曳歸檔
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              請直接點擊或將檔案拖曳至下方的指定目錄區塊，系統將自動套用標準檔名並同步至 Google Drive。
            </p>
          </div>
        </div>

        {successMessage && (
          <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl flex items-start animate-in zoom-in-95">
            <CheckCircle2 className="text-emerald-500 mr-3 mt-0.5 flex-shrink-0" size={20} />
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400 whitespace-pre-line">{successMessage}</span>
          </div>
        )}

        {/* 動態目錄拖曳區塊 */}
        {projectFolders.length === 0 ? (
          <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-16 flex flex-col items-center justify-center text-center bg-slate-50 dark:bg-slate-800/50">
            <AlertTriangle size={48} className="text-amber-500 mb-4" />
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-2">此專案尚未設定任何歸檔目錄</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md">
              請先前往左側選單的「系統設定與日誌」&gt;「系統管理與專案設定」中，為【{projectName || '未命名專案'}】建立目錄結構。
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projectFolders.map((folder) => (
              <div 
                key={folder.id}
                onDragEnter={(e) => handleDragEnter(e, folder.id)}
                onDragLeave={handleDragLeave}
                onDragOver={(e) => handleDragOver(e, folder.id)}
                onDrop={(e) => handleDrop(e, folder)}
                onClick={() => document.getElementById(`file-upload-${folder.id}`).click()}
                className={`relative overflow-hidden flex flex-col items-center justify-center p-8 rounded-2xl border-2 transition-all cursor-pointer group ${
                  dragActiveId === folder.id 
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/20 scale-105 shadow-lg' 
                    : 'border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:border-indigo-400 dark:hover:border-indigo-500/50'
                }`}
              >
                {/* 隱藏的檔案輸入器 */}
                <input 
                  type="file" 
                  id={`file-upload-${folder.id}`} 
                  className="hidden" 
                  onChange={(e) => handleFileChange(e, folder)}
                />

                {uploadingTo === folder.id ? (
                  <div className="flex flex-col items-center justify-center text-indigo-600 dark:text-indigo-400">
                    <Loader2 size={40} className="animate-spin mb-3" />
                    <p className="text-sm font-bold animate-pulse">正在同步至 Google Drive...</p>
                  </div>
                ) : (
                  <>
                    <div className={`p-4 rounded-full mb-4 transition-transform duration-300 ${dragActiveId === folder.id ? 'bg-indigo-100 dark:bg-indigo-900/50 scale-110' : 'bg-slate-100 dark:bg-slate-700 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/30'}`}>
                      <FileUp size={32} className={`${dragActiveId === folder.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 group-hover:text-indigo-500 dark:group-hover:text-indigo-400'}`} />
                    </div>
                    
                    <div className="text-center space-y-1 w-full">
                      <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">拖曳至此以歸檔</p>
                      <div className="flex items-center justify-center text-sm font-bold text-slate-800 dark:text-slate-200">
                        <span className="truncate max-w-[120px]" title={folder.level1}>{folder.level1}</span>
                        {folder.level2 && (
                          <>
                            <ChevronRight size={14} className="mx-1 text-slate-400 flex-shrink-0" />
                            <span className="truncate max-w-[120px]" title={folder.level2}>{folder.level2}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </>
                )}
                
                {/* 裝飾性遮罩 (當處於拖曳狀態時顯示) */}
                {dragActiveId === folder.id && !uploadingTo && (
                  <div className="absolute inset-0 bg-indigo-500/10 pointer-events-none rounded-2xl"></div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
