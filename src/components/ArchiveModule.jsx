import React, { useState, useEffect, useRef } from 'react';
import { Upload, FolderArchive, Folder, ChevronRight, Loader2, CheckCircle2, AlertTriangle, FileUp, ExternalLink, List, FileText, ChevronDown, ChevronUp, Info, ShieldCheck } from 'lucide-react';
import { collection, onSnapshot, addDoc, getFirestore } from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';

// 確保正確取得或初始化 Firebase App 與 DB
const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

// 【架構升級】：優先從環境變數讀取 Client ID，若無則降級使用預設的實體字串
const DRIVE_CLIENT_ID = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) 
  || '134813517167-s4t64mucti470adauc6mvpbrtn0ncont.apps.googleusercontent.com';

// ================= 100% 真實 Google Drive API 上傳引擎 =================
const uploadToGoogleDrive = async (file, fileName, pathArray, accessToken) => {
  let parentId = 'root'; 

  // 依序檢查並建立多層資料夾：專案管理系統 -> {計畫名稱} -> {第一層目錄} -> {第二層目錄}
  for (const folderName of pathArray) {
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id, name)`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (searchRes.status === 401) throw new Error('UNAUTHORIZED');
    
    const searchData = await searchRes.json();

    if (searchData.files && searchData.files.length > 0) {
      parentId = searchData.files[0].id;
    } else {
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
      if (createRes.status === 401) throw new Error('UNAUTHORIZED');
      const createData = await createRes.json();
      parentId = createData.id;
    }
  }

  // 上傳實體檔案至最終目錄 (使用 Multipart 支援檔案與 metadata 一起上傳)
  const metadata = { name: fileName, parents: [parentId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form
  });

  if (uploadRes.status === 401) throw new Error('UNAUTHORIZED');
  return await uploadRes.json(); // 回傳真實 URL
};

export default function ArchiveModule({ user, selectedProject }) {
  const [projectFolders, setProjectFolders] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [dragActiveId, setDragActiveId] = useState(null);
  const [uploadingTo, setUploadingTo] = useState(null);
  
  // 訊息提示狀態
  const [successMessage, setSuccessMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  
  // 控制哪個目錄的檔案清單被展開
  const [expandedFolderId, setExpandedFolderId] = useState(null);
  
  // 真實檔案狀態：儲存從資料庫拉取出來的所有檔案紀錄
  const [uploadedFiles, setUploadedFiles] = useState([]);

  // ================= 授權相關狀態 (Google Identity Services) =================
  const tokenClientRef = useRef(null);
  const [isDriveAuthorized, setIsDriveAuthorized] = useState(!!localStorage.getItem('google_drive_access_token'));

  // 載入 Google Identity Services SDK 並初始化 Token Client
  useEffect(() => {
    const initGis = () => {
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: DRIVE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (tokenResponse) => {
          if (tokenResponse && tokenResponse.access_token) {
            localStorage.setItem('google_drive_access_token', tokenResponse.access_token);
            setIsDriveAuthorized(true);
            showInfo("✅ 雲端硬碟授權成功！系統已就緒，您可以開始拖曳歸檔了。");
          }
        },
      });
    };

    if (!window.google) {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = initGis;
      document.body.appendChild(script);
    } else {
      initGis();
    }
  }, []);

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
    e.preventDefault(); e.stopPropagation();
    setDragActiveId(folderId);
  };

  const handleDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragActiveId(null);
  };

  const handleDragOver = (e, folderId) => {
    e.preventDefault(); e.stopPropagation();
    setDragActiveId(folderId);
  };

  const handleDrop = (e, folder) => {
    e.preventDefault(); e.stopPropagation();
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

  // 顯示操作提示
  const showInfo = (message) => {
    setInfoMessage(message);
    setTimeout(() => setInfoMessage(''), 6000);
  };

  // 處理檔案上傳、串接 Google Drive 與寫入 Firebase
  const processUpload = async (folder, file) => {
    // 檢查是否已授權
    const currentToken = localStorage.getItem('google_drive_access_token');
    if (!currentToken) {
      showInfo("⚠️ 尚未授權，正在為您開啟 Google 授權視窗...");
      tokenClientRef.current?.requestAccessToken();
      return;
    }

    setUploadingTo(folder.id);
    setSuccessMessage('');
    setInfoMessage('');
    
    try {
      const targetPath = `專案管理系統 / ${projectName} / ${folder.level1} ${folder.level2 ? `/ ${folder.level2}` : ''}`;
      
      // 產生標準化自動命名
      const todayStr = new Date().toISOString().split('T')[0];
      const autoNamedFile = `[自動命名]_${todayStr.replace(/-/g, '')}_${file.name}`;
      
      const pathArray = ['專案管理系統', projectName, folder.level1, folder.level2].filter(Boolean);
      
      // 呼叫真實的 API 上傳引擎
      const driveRes = await uploadToGoogleDrive(file, autoNamedFile, pathArray, currentToken);
      const realFileUrl = driveRes.webViewLink || '#';

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

      setSuccessMessage(`✅ 檔案已成功自動建檔並上傳至真實 Google Drive：\n${targetPath}`);
      
      if (expandedFolderId !== folder.id) {
        setExpandedFolderId(folder.id);
      }
      
    } catch (error) {
      console.error("真實上傳失敗:", error);
      if (error.message === 'UNAUTHORIZED') {
        localStorage.removeItem('google_drive_access_token');
        setIsDriveAuthorized(false);
        showInfo("⚠️ Google 授權已過期，請點擊上方按鈕重新授權！");
      } else {
        showInfo("❌ 歸檔失敗，請確認您的權限或網路連線。");
      }
    } finally {
      setUploadingTo(null);
      setTimeout(() => setSuccessMessage(''), 5000);
    }
  };

  const toggleFolderExpand = (folderId) => {
    if (expandedFolderId === folderId) {
      setExpandedFolderId(null);
    } else {
      setExpandedFolderId(folderId);
    }
  };

  const handleOpenDrive = (url) => {
    if (url && url !== '#') {
      window.open(url, '_blank');
    } else {
      window.open('https://drive.google.com/drive/my-drive', '_blank');
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      
      {/* 授權橫幅 (未授權或過期時顯示) */}
      {!isDriveAuthorized && (
        <div className="bg-indigo-50 dark:bg-indigo-500/10 border-2 border-indigo-500/50 p-6 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-4 animate-in slide-in-from-top-4 shadow-sm">
          <div className="flex items-center text-indigo-800 dark:text-indigo-300">
            <div className="p-3 bg-indigo-100 dark:bg-indigo-900/50 rounded-full mr-4">
              <ShieldCheck size={28} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className="font-black text-lg mb-1">啟用 Google Drive 歸檔引擎</h3>
              <p className="text-sm font-medium opacity-80">系統需要您的授權，才能在背景自動為您建立資料夾並上傳檔案。</p>
            </div>
          </div>
          <button 
            onClick={() => tokenClientRef.current?.requestAccessToken()} 
            className="w-full md:w-auto px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md transition-all active:scale-95 flex items-center justify-center whitespace-nowrap"
          >
            立即授權連線
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 border-b border-slate-100 dark:border-slate-700/50 pb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center">
              <Upload className="mr-3 text-indigo-500" size={24} />
              直覺式拖曳歸檔與調閱 (真實連線版)
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              請直接點擊或拖曳檔案至對應的目錄，系統將自動套用標準檔名，並真實同步至您的 Google Drive。
            </p>
          </div>
        </div>

        {/* 成功與提示訊息顯示區 */}
        {successMessage && (
          <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl flex items-start animate-in zoom-in-95">
            <CheckCircle2 className="text-emerald-500 mr-3 mt-0.5 flex-shrink-0" size={20} />
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400 whitespace-pre-line">{successMessage}</span>
          </div>
        )}
        
        {infoMessage && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl flex items-start animate-in zoom-in-95">
            <Info className="text-blue-500 mr-3 mt-0.5 flex-shrink-0" size={20} />
            <span className="text-sm font-bold text-blue-700 dark:text-blue-400 whitespace-pre-line">{infoMessage}</span>
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
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/20 scale-[1.02] shadow-lg' 
                              : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30 hover:border-indigo-300 dark:hover:border-indigo-500/50'
                          }`}
                        >
                          <input 
                            type="file" 
                            id={`file-upload-${folder.id}`} 
                            className="hidden" 
                            onChange={(e) => handleFileChange(e, folder)}
                          />

                          {uploadingTo === folder.id ? (
                            <div className="flex flex-col items-center justify-center text-indigo-600 dark:text-indigo-400 min-h-[100px]">
                              <Loader2 size={36} className="animate-spin mb-3" />
                              <p className="text-sm font-bold animate-pulse">真實上傳中，請稍候...</p>
                            </div>
                          ) : (
                            <div className="min-h-[100px] flex flex-col items-center justify-center w-full">
                              <div className={`p-3 rounded-full mb-3 transition-transform duration-300 ${dragActiveId === folder.id ? 'bg-indigo-100 dark:bg-indigo-900/50 scale-110' : 'bg-slate-100 dark:bg-slate-700 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/30'}`}>
                                <FileUp size={28} className={`${dragActiveId === folder.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 group-hover:text-indigo-500 dark:group-hover:text-indigo-400'}`} />
                              </div>
                              
                              <div className="text-center w-full">
                                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mb-1">拖曳至此以歸檔</p>
                                <div className="flex items-center justify-center text-base font-bold text-slate-800 dark:text-slate-200">
                                  <span className="truncate max-w-[180px]" title={folder.level2 || `${groupName} (根目錄)`}>
                                    {folder.level2 ? folder.level2 : <span className="text-slate-500 italic text-sm">此為第一層根目錄</span>}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {dragActiveId === folder.id && !uploadingTo && (
                            <div className="absolute inset-0 bg-indigo-500/5 pointer-events-none rounded-2xl"></div>
                          )}
                        </div>

                        {/* 下半部：操作控制列 */}
                        <div className="bg-slate-50 dark:bg-slate-800/80 p-2 flex items-center justify-between">
                          <button 
                            onClick={() => toggleFolderExpand(folder.id)}
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                          >
                            <List size={14} className="text-indigo-500" />
                            <span>{folderFiles.length} 個檔案</span>
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>

                          <button 
                            onClick={() => handleOpenDrive(folderFiles[0]?.url)}
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors"
                            title="開啟 Google Drive 對應目錄或檔案"
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
                                  <li 
                                    key={f.id} 
                                    onClick={() => handleOpenDrive(f.url)}
                                    className="flex items-center justify-between p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg group transition-colors cursor-pointer" 
                                    title={f.name}
                                  >
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
