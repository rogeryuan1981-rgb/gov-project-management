import React, { useState, useEffect, useRef } from 'react';
import { Upload, FolderArchive, Folder, ChevronRight, Loader2, CheckCircle2, AlertTriangle, FileUp, ExternalLink, List, FileText, ChevronDown, ChevronUp, Info, ShieldCheck, RefreshCw } from 'lucide-react';
import { collection, onSnapshot, getFirestore } from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';

// 確保正確取得或初始化 Firebase App 與 DB
const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

// 優先從環境變數讀取 Client ID，若無則降級使用預設的實體字串
const DRIVE_CLIENT_ID = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) 
  || '134813517167-s4t64mucti470adauc6mvpbrtn0ncont.apps.googleusercontent.com';

// ================= 真實 Google Drive API 引擎 =================

// 尋找或建立單一資料夾
const getOrCreateFolder = async (folderName, parentId, accessToken) => {
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id, webViewLink)`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (searchRes.status === 401) throw new Error('UNAUTHORIZED');
  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0]; // { id, webViewLink }
  } else {
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
    });
    if (createRes.status === 401) throw new Error('UNAUTHORIZED');
    return await createRes.json();
  }
};

// 僅尋找資料夾 (不建立)
const findFolder = async (folderName, parentId, accessToken) => {
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id, webViewLink)`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (searchRes.status === 401) throw new Error('UNAUTHORIZED');
  const searchData = await searchRes.json();
  return searchData.files && searchData.files.length > 0 ? searchData.files[0] : null;
};

// 上傳檔案
const uploadToGoogleDrive = async (file, fileName, pathArray, accessToken) => {
  let parentId = 'root'; 
  for (const folderName of pathArray) {
    const folder = await getOrCreateFolder(folderName, parentId, accessToken);
    parentId = folder.id;
  }

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
  return await uploadRes.json(); 
};

export default function ArchiveModule({ user, selectedProject }) {
  const [projectFolders, setProjectFolders] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [dragActiveId, setDragActiveId] = useState(null);
  const [uploadingTo, setUploadingTo] = useState(null);
  
  const [successMessage, setSuccessMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [expandedFolderId, setExpandedFolderId] = useState(null);
  
  // 100% 真實同步狀態
  const [driveFiles, setDriveFiles] = useState({}); // { folderId: [files...] }
  const [driveFolderLinks, setDriveFolderLinks] = useState({}); // { folderId: webViewLink }
  const [isSyncingDrive, setIsSyncingDrive] = useState(false);

  const tokenClientRef = useRef(null);
  const [isDriveAuthorized, setIsDriveAuthorized] = useState(!!localStorage.getItem('google_drive_access_token'));

  // 初始化 Google Identity Services
  useEffect(() => {
    const initGis = () => {
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: DRIVE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (tokenResponse) => {
          if (tokenResponse && tokenResponse.access_token) {
            localStorage.setItem('google_drive_access_token', tokenResponse.access_token);
            setIsDriveAuthorized(true);
            showInfo("✅ 雲端硬碟授權成功！");
            syncAllDriveData(tokenResponse.access_token); // 授權後立刻同步
          }
        },
      });
    };

    if (!window.google) {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true; script.defer = true; script.onload = initGis;
      document.body.appendChild(script);
    } else {
      initGis();
    }
  }, []);

  // 監聽專案設定的「目錄結構」
  useEffect(() => {
    if (!user || !selectedProject) return;

    const projectsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'projects');
    const unsubscribe = onSnapshot(projectsRef, (snapshot) => {
      const loadedProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const currentProject = loadedProjects.find(p => p.id === selectedProject);
      
      if (currentProject) {
        setProjectName(currentProject.name);
        setProjectFolders(currentProject.folders || []);
      }
    });

    return () => unsubscribe();
  }, [user, selectedProject]);

  // 當專案切換或目錄結構載入後，自動去 Google Drive 同步真實檔案
  useEffect(() => {
    if (isDriveAuthorized && projectFolders.length > 0 && projectName) {
      const token = localStorage.getItem('google_drive_access_token');
      syncAllDriveData(token);
    }
  }, [projectName, projectFolders.length, isDriveAuthorized]);

  // ================= 核心：實時同步 Google Drive =================
  const syncAllDriveData = async (token) => {
    if (!token) return;
    setIsSyncingDrive(true);
    
    try {
      const newDriveFiles = {};
      const newFolderLinks = {};

      // 1. 找根目錄
      const sysRoot = await findFolder('專案管理系統', 'root', token);
      if (!sysRoot) { setDriveFiles({}); setIsSyncingDrive(false); return; }

      // 2. 找專案目錄
      const projFolder = await findFolder(projectName, sysRoot.id, token);
      if (!projFolder) { setDriveFiles({}); setIsSyncingDrive(false); return; }

      // 3. 遍歷設定的目錄去 Drive 抓實體檔案
      for (const folder of projectFolders) {
        let level1 = await findFolder(folder.level1, projFolder.id, token);
        if (!level1) { newDriveFiles[folder.id] = []; continue; }

        let targetFolderId = level1.id;
        let targetFolderLink = level1.webViewLink;

        if (folder.level2) {
          let level2 = await findFolder(folder.level2, level1.id, token);
          if (!level2) { newDriveFiles[folder.id] = []; continue; }
          targetFolderId = level2.id;
          targetFolderLink = level2.webViewLink;
        }

        newFolderLinks[folder.id] = targetFolderLink;

        // 抓取該層級下的所有實體檔案
        const filesRes = await fetch(`https://www.googleapis.com/drive/v3/files?q='${targetFolderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false&fields=files(id, name, createdTime, webViewLink)&orderBy=createdTime desc`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const filesData = await filesRes.json();
        
        newDriveFiles[folder.id] = (filesData.files || []).map(f => ({
          id: f.id,
          name: f.name,
          date: new Date(f.createdTime).toISOString().split('T')[0],
          url: f.webViewLink
        }));
      }

      setDriveFiles(newDriveFiles);
      setDriveFolderLinks(newFolderLinks);

    } catch (e) {
      console.error("Drive Sync Error:", e);
      if (e.message === 'UNAUTHORIZED') {
        localStorage.removeItem('google_drive_access_token');
        setIsDriveAuthorized(false);
      }
    } finally {
      setIsSyncingDrive(false);
    }
  };

  const groupedFolders = React.useMemo(() => {
    return projectFolders.reduce((acc, folder) => {
      const groupName = folder.level1 ? folder.level1.trim() : '未分類目錄';
      if (!acc[groupName]) acc[groupName] = [];
      acc[groupName].push(folder);
      return acc;
    }, {});
  }, [projectFolders]);

  const handleDragEnter = (e, folderId) => { e.preventDefault(); e.stopPropagation(); setDragActiveId(folderId); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setDragActiveId(null); };
  const handleDragOver = (e, folderId) => { e.preventDefault(); e.stopPropagation(); setDragActiveId(folderId); };
  const handleDrop = (e, folder) => {
    e.preventDefault(); e.stopPropagation(); setDragActiveId(null);
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

  const showInfo = (message) => {
    setInfoMessage(message);
    setTimeout(() => setInfoMessage(''), 6000);
  };

  // 執行 100% 真實上傳，並實時刷新畫面
  const processUpload = async (folder, file) => {
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
      
      const todayStr = new Date().toISOString().split('T')[0];
      const autoNamedFile = `[自動命名]_${todayStr.replace(/-/g, '')}_${file.name}`;
      
      const pathArray = ['專案管理系統', projectName, folder.level1, folder.level2].filter(Boolean);
      
      // 1. 真實上傳至 Drive
      const driveRes = await uploadToGoogleDrive(file, autoNamedFile, pathArray, currentToken);
      
      // 2. 本地直接更新狀態 (不經過 Firebase) 以達到最高效的即時顯示
      const newFileObj = {
        id: driveRes.id,
        name: autoNamedFile,
        date: todayStr,
        url: driveRes.webViewLink
      };
      
      setDriveFiles(prev => ({
        ...prev,
        [folder.id]: [newFileObj, ...(prev[folder.id] || [])]
      }));

      setSuccessMessage(`✅ 檔案已成功自動建檔並上傳至真實 Google Drive：\n${targetPath}`);
      
      if (expandedFolderId !== folder.id) setExpandedFolderId(folder.id);
      
    } catch (error) {
      console.error("真實上傳失敗:", error);
      if (error.message === 'UNAUTHORIZED') {
        localStorage.removeItem('google_drive_access_token');
        setIsDriveAuthorized(false);
        showInfo("⚠️ Google 授權已過期，請點擊上方按鈕重新授權！");
      } else {
        showInfo("❌ 上傳失敗，請確認您的權限或網路連線。");
      }
    } finally {
      setUploadingTo(null);
      setTimeout(() => setSuccessMessage(''), 5000);
    }
  };

  const handleManualSync = () => {
    const token = localStorage.getItem('google_drive_access_token');
    if (token) {
      showInfo("🔄 正在掃描 Google Drive 雲端硬碟最新狀態...");
      syncAllDriveData(token);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      
      {!isDriveAuthorized && (
        <div className="bg-indigo-50 dark:bg-indigo-500/10 border-2 border-indigo-500/50 p-6 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-4 animate-in slide-in-from-top-4 shadow-sm">
          <div className="flex items-center text-indigo-800 dark:text-indigo-300">
            <div className="p-3 bg-indigo-100 dark:bg-indigo-900/50 rounded-full mr-4">
              <ShieldCheck size={28} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className="font-black text-lg mb-1">啟用 Google Drive 歸檔引擎</h3>
              <p className="text-sm font-medium opacity-80">系統需要您的授權，才能實時抓取與建立真實檔案。</p>
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
              直覺式拖曳歸檔與調閱 (即時同步版)
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 flex items-center">
              此畫面所見之檔案皆 100% 來自真實 Google Drive 雲端。
            </p>
          </div>
          
          {/* 加入手動重新掃描按鈕 */}
          {isDriveAuthorized && (
            <button 
              onClick={handleManualSync}
              disabled={isSyncingDrive}
              className="mt-4 md:mt-0 flex items-center space-x-2 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold text-sm hover:bg-indigo-50 dark:hover:bg-indigo-500/20 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              <RefreshCw size={16} className={isSyncingDrive ? "animate-spin" : ""} />
              <span>重新掃描雲端</span>
            </button>
          )}
        </div>

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
              請先前往「系統設定」建立目錄結構。
            </p>
          </div>
        ) : (
          <div className="space-y-8 relative">
            
            {/* 掃描覆蓋層 */}
            {isSyncingDrive && (
              <div className="absolute inset-0 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm z-10 flex flex-col items-center justify-center rounded-2xl">
                <Loader2 size={40} className="animate-spin text-indigo-500 mb-4" />
                <span className="font-bold text-indigo-700 dark:text-indigo-400 bg-white dark:bg-slate-800 px-6 py-2 rounded-full shadow-md">與 Google Drive 即時掃描比對中...</span>
              </div>
            )}

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
                    const actualFiles = driveFiles[folder.id] || [];
                    const isExpanded = expandedFolderId === folder.id;
                    const driveFolderUrl = driveFolderLinks[folder.id] || 'https://drive.google.com/drive/my-drive';

                    return (
                      <div key={folder.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col transition-all duration-300 hover:shadow-md">
                        
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
                          <input type="file" id={`file-upload-${folder.id}`} className="hidden" onChange={(e) => handleFileChange(e, folder)} />

                          {uploadingTo === folder.id ? (
                            <div className="flex flex-col items-center justify-center text-indigo-600 dark:text-indigo-400 min-h-[100px]">
                              <Loader2 size={36} className="animate-spin mb-3" />
                              <p className="text-sm font-bold animate-pulse">實體上傳中...</p>
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

                        <div className="bg-slate-50 dark:bg-slate-800/80 p-2 flex items-center justify-between">
                          <button 
                            onClick={() => setExpandedFolderId(isExpanded ? null : folder.id)}
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                          >
                            <List size={14} className="text-indigo-500" />
                            <span>{actualFiles.length} 個實體檔案</span>
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>

                          <button 
                            onClick={() => window.open(driveFolderUrl, '_blank')}
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors"
                            title="開啟 Google Drive 此目錄"
                          >
                            <ExternalLink size={14} />
                            <span>前往目錄</span>
                          </button>
                        </div>

                        {isExpanded && (
                          <div className="bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-700 max-h-48 overflow-y-auto p-2 animate-in slide-in-from-top-2 fade-in">
                            {actualFiles.length === 0 ? (
                              <p className="text-xs text-center py-4 text-slate-400">目前雲端目錄中尚無實體檔案</p>
                            ) : (
                              <ul className="space-y-1">
                                {actualFiles.map(f => (
                                  <li 
                                    key={f.id} 
                                    onClick={() => window.open(f.url, '_blank')}
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
