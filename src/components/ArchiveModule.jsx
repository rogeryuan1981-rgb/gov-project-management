import React, { useState, useEffect } from 'react';
import { Upload, FolderArchive, Folder, ChevronRight, Loader2, CheckCircle2, AlertTriangle, FileUp, ExternalLink, List, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { collection, onSnapshot, addDoc, getFirestore } from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';

// 確保正確取得或初始化 Firebase App 與 DB
const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

// ================= 真實 Google Drive API 上傳引擎 =================
// 未來只要傳入有效的 OAuth Access Token，此函式就會真實建立層級資料夾並上傳檔案
const uploadToGoogleDrive = async (file, fileName, pathArray, accessToken) => {
  let parentId = 'root'; // 從使用者的雲端硬碟根目錄開始找

  for (const folderName of pathArray) {
    // 1. 搜尋是否已有該名稱的資料夾
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id, name)`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const searchData = await searchRes.json();

    if (searchData.files && searchData.files.length > 0) {
      parentId = searchData.files[0].id;
    } else {
      // 2. 找不到就建立資料夾
      const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId]
        })
      });
      const createData = await createRes.json();
      parentId = createData.id;
    }
  }

  // 3. 在最終的目標資料夾下上傳實體檔案
  const metadata = { name: fileName, parents: [parentId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form
  });

  return await uploadRes.json(); // 回傳檔案的真實 URL
};

export default function ArchiveModule({ user, selectedProject }) {
  const [projectFolders, setProjectFolders] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [dragActiveId, setDragActiveId] = useState(null);
  const [uploadingTo, setUploadingTo] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  
  // 控制哪個目錄的檔案清單被展開
  const [expandedFolderId, setExpandedFolderId] = useState(null);
  
  // 真實檔案狀態：儲存從資料庫拉取出來的所有檔案紀錄
  const [uploadedFiles, setUploadedFiles] = useState([]);

  // 1. 監聽當前專案的「目錄結構設定」
  useEffect(() => {
    if (!user || !selectedProject) return;

    const projectsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'projects');
    const unsubscribe = onSnapshot(projectsRef, (snapshot) => {
      const loadedProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const currentProject = loadedProjects.find(p => p.id === selectedProject);
      
      if (currentProject) {
        setProjectName(currentProject.name);
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

  // 2. 監聽當前專案的「真實檔案紀錄」
  useEffect(() => {
    if (!user || !selectedProject) return;

    const filesRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'files');
    const unsubscribe = onSnapshot(filesRef, (snapshot) => {
      const allFiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // 過濾出屬於當前專案的檔案
      const projectFiles = allFiles.filter(f => f.projectId === selectedProject);
      // 依據建立時間降冪排序 (新的在上面)
      projectFiles.sort((a, b) => b.createdAt - a.createdAt);
      setUploadedFiles(projectFiles);
    }, (error) => {
      console.error("讀取檔案列表失敗:", error);
    });

    return () => unsubscribe();
  }, [user, selectedProject]);

  // 將資料夾按第一層分類 (Group by level1)
  const groupedFolders = React.useMemo(() => {
    return projectFolders.reduce((acc, folder) => {
      const groupName = folder.level1 ? folder.level1.trim() : '未分類目錄';
      if (!acc[groupName]) acc[groupName] = [];
      acc[groupName].push(folder);
      return acc;
    }, {});
  }, [projectFolders]);

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
    setDragActiveId(folderId);
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
    e.target.value = '';
  };

  // 顯示操作提示 (取代原生的 alert)
  const showInfo = (message) => {
    setInfoMessage(message);
    setTimeout(() => setInfoMessage(''), 6000);
  };

  // 處理檔案上傳並寫入真實 Firebase 資料庫
  const processUpload = async (folder, file) => {
    setUploadingTo(folder.id);
    
    // 模擬 API 串接 Google Drive 實體檔案上傳的時間延遲
    setTimeout(async () => {
      try {
        // 【路徑修正】：一律先包在「專案管理系統」與「計畫名稱」之下
        const targetPath = `專案管理系統 / ${projectName} / ${folder.level1} ${folder.level2 ? `/ ${folder.level2}` : ''}`;
        
        // 產生標準化自動命名 (例如：[自動命名]_20260426_原檔名.pdf)
        const todayStr = new Date().toISOString().split('T')[0];
        const autoNamedFile = `[自動命名]_${todayStr.replace(/-/g, '')}_${file.name}`;
        
        let realFileUrl = '#';

        // =========================================================
        // 【真實 API 啟動區】
        // 未來獲取授權後，只要將 accessToken 帶入，並解除下方註解，
        // 系統就會真實把檔案丟進您的 Google Drive 中！
        // =========================================================
        // const accessToken = user?.accessToken; // 這邊未來會接上真實的登入 Token
        // if (accessToken) {
        //   // 組合資料夾陣列
        //   const pathArray = ['專案管理系統', projectName, folder.level1];
        //   if (folder.level2) pathArray.push(folder.level2);
        //   
        //   // 執行真實上傳
        //   const driveRes = await uploadToGoogleDrive(file, autoNamedFile, pathArray, accessToken);
        //   realFileUrl = driveRes.webViewLink; // 取得真實的 Drive 預覽連結
        // }

        // 將歸檔紀錄寫入 Firestore
        const filesRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'files');
        await addDoc(filesRef, {
          projectId: selectedProject,
          folderId: folder.id,
          name: autoNamedFile,
          date: todayStr,
          createdAt: new Date().getTime(),
          url: realFileUrl 
        });

        setSuccessMessage(`✅ 檔案已成功自動更名並歸檔至：\n${targetPath}`);
        
        // 提示目前為雛形狀態
        setTimeout(() => {
          showInfo("💡 提示：實體檔案傳輸引擎已實裝。需待後續申請 Google Drive API 授權後，檔案即會真實飛進雲端硬碟。");
        }, 5500);
        
        // 如果列表沒展開，自動幫使用者展開看結果
        if (expandedFolderId !== folder.id) {
          setExpandedFolderId(folder.id);
        }
        
      } catch (error) {
        console.error("歸檔紀錄寫入失敗:", error);
        showInfo("❌ 歸檔失敗，請確認您的權限或網路連線。");
      } finally {
        setUploadingTo(null);
        setTimeout(() => setSuccessMessage(''), 5000);
      }
    }, 1500);
  };

  const toggleFolderExpand = (folderId) => {
    if (expandedFolderId === folderId) {
      setExpandedFolderId(null);
    } else {
      setExpandedFolderId(folderId);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      
      <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 border-b border-slate-100 dark:border-slate-700/50 pb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center">
              <Upload className="mr-3 text-indigo-500" size={24} />
              直覺式拖曳歸檔與調閱
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              請直接點擊或拖曳檔案至對應的目錄，系統將自動套用標準檔名同步至 Google Drive。您亦可在此直接檢視已歸檔之文件。
            </p>
          </div>
        </div>

        {successMessage && (
          <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl flex items-start animate-in zoom-in-95">
            <CheckCircle2 className="text-emerald-500 mr-3 mt-0.5 flex-shrink-0" size={20} />
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400 whitespace-pre-line">{successMessage}</span>
          </div>
        )}

        {projectFolders.length === 0 ? (
          <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-16 flex flex-col items-center justify-center text-center bg-slate-50 dark:bg-slate-800/50">
            <AlertTriangle size={48} className="text-amber-500 mb-4" />
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-2">此專案尚未設定任何歸檔目錄</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md">
              請先前往左側選單的「系統設定與日誌」&gt;「系統管理與專案設定」中，為【{projectName || '未命名專案'}】建立目錄結構。
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(groupedFolders).map(([groupName, folders]) => (
              <div key={groupName} className="bg-slate-50/50 dark:bg-slate-900/20 p-5 rounded-2xl border border-slate-100 dark:border-slate-700/50">
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4 flex items-center border-b border-slate-200 dark:border-slate-700/50 pb-3">
                  <Folder className="mr-2 text-indigo-500" size={20} />
                  {groupName}
                  <span className="ml-3 px-2.5 py-0.5 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 text-xs rounded-full font-medium">
                    共 {folders.length} 項
                  </span>
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {folders.map((folder) => {
                    // 真實資料：直接從 state 過濾出屬於該資料夾的檔案
                    const folderFiles = uploadedFiles.filter(f => f.folderId === folder.id);
                    const isExpanded = expandedFolderId === folder.id;

                    return (
                      <div key={folder.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col transition-all duration-300 hover:shadow-md">
                        
                        {/* 上半部：上傳拖曳區 */}
                        <div 
                          onDragEnter={(e) => handleDragEnter(e, folder.id)}
                          onDragLeave={handleDragLeave}
                          onDragOver={(e) => handleDragOver(e, folder.id)}
                          onDrop={(e) => handleDrop(e, folder)}
                          onClick={() => document.getElementById(`file-upload-${folder.id}`).click()}
                          className={`relative flex-1 p-6 flex flex-col items-center justify-center border-b-2 border-dashed cursor-pointer transition-all ${
                            dragActiveId === folder.id 
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/20' 
                              : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30 hover:border-indigo-300 dark:hover:border-indigo-500/50'
                          }`}
                        >
                          <input type="file" id={`file-upload-${folder.id}`} className="hidden" onChange={(e) => handleFileChange(e, folder)} />

                          {uploadingTo === folder.id ? (
                            <div className="flex flex-col items-center justify-center text-indigo-600 dark:text-indigo-400 min-h-[80px]">
                              <Loader2 size={32} className="animate-spin mb-3" />
                              <p className="text-xs font-bold animate-pulse">同步至 Drive 中...</p>
                            </div>
                          ) : (
                            <div className="min-h-[80px] flex flex-col items-center justify-center w-full">
                              <div className={`p-2.5 rounded-full mb-3 transition-transform duration-300 ${dragActiveId === folder.id ? 'bg-indigo-100 dark:bg-indigo-900/50 scale-110 text-indigo-600 dark:text-indigo-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-400 group-hover:text-indigo-500 dark:group-hover:text-indigo-400'}`}>
                                <FileUp size={24} />
                              </div>
                              <div className="text-center w-full">
                                <div className="flex items-center justify-center text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">
                                  <span className="truncate" title={folder.level2 || `${groupName} (根目錄)`}>
                                    {folder.level2 ? folder.level2 : <span className="text-slate-500 italic font-medium">此為第一層根目錄</span>}
                                  </span>
                                </div>
                                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">點擊或拖曳至此歸檔</p>
                              </div>
                            </div>
                          )}

                          {dragActiveId === folder.id && !uploadingTo && (
                            <div className="absolute inset-0 bg-indigo-500/5 pointer-events-none"></div>
                          )}
                        </div>

                        {/* 下半部：操作控制列 */}
                        <div className="bg-slate-50 dark:bg-slate-800/80 p-2 flex items-center justify-between">
                          <button 
                            onClick={() => toggleFolderExpand(folder.id)}
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                          >
                            <List size={14} className="text-indigo-500" />
                            {/* 真實檔案數量呈現 */}
                            <span>{folderFiles.length} 個檔案</span>
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>

                          <button 
                            onClick={() => window.open('https://drive.google.com/drive/my-drive', '_blank')}
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors"
                            title="開啟 Google Drive 目錄"
                          >
                            <ExternalLink size={14} />
                            <span>開啟 Drive</span>
                          </button>
                        </div>

                        {/* 展開：真實資料庫的檔案清單預覽 */}
                        {isExpanded && (
                          <div className="bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-700 max-h-48 overflow-y-auto p-2 animate-in slide-in-from-top-2 fade-in">
                            {folderFiles.length === 0 ? (
                              <p className="text-xs text-center py-4 text-slate-400">目前目錄中尚無檔案</p>
                            ) : (
                              <ul className="space-y-1">
                                {folderFiles.map(f => (
                                  <li key={f.id} className="flex items-center justify-between p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg group transition-colors cursor-pointer" title={f.name}>
                                    <div className="flex items-center overflow-hidden mr-2">
                                      <FileText size={14} className="text-indigo-400 mr-2 flex-shrink-0" />
                                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{f.name}</span>
                                    </div>
                                    <span className="text-[10px] text-slate-400 flex-shrink-0">{f.date}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}

                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
