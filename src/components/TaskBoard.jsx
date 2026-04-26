import React, { useState, useEffect, useRef } from 'react';
import { Search, Filter, Plus, ChevronRight, ChevronDown, AlertCircle, Calendar, FolderArchive, FileText, Download, Loader2, FileSpreadsheet, Edit2, Save, X, Trash2, ExternalLink } from 'lucide-react';
import { collection, onSnapshot, doc, setDoc, updateDoc, getFirestore, addDoc } from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';

const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

// 專屬 Google Drive API 金鑰
const DRIVE_CLIENT_ID = '134813517167-s4t64mucti470adauc6mvpbrtn0ncont.apps.googleusercontent.com';

// ================= 真實 Google Drive API 引擎 =================
const getOrCreateFolder = async (folderName, parentId, accessToken) => {
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (searchRes.status === 401) throw new Error('UNAUTHORIZED');
  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0];
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
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form
  });
  if (uploadRes.status === 401) throw new Error('UNAUTHORIZED');
  return await uploadRes.json(); 
};

export default function TaskBoard({ user, selectedProject, selectedTask, setSelectedTask }) {
  const [tasks, setTasks] = useState([]);
  const [personnel, setPersonnel] = useState([]); // 新增：專案人員狀態
  const [projectName, setProjectName] = useState('');
  const [taskFiles, setTaskFiles] = useState([]);
  const fileInputRef = useRef(null);
  
  const [isImporting, setIsImporting] = useState(false);
  const [uploadingTaskFiles, setUploadingTaskFiles] = useState({});

  const [sortConfig, setSortConfig] = useState({ key: 'uid', direction: 'asc' });
  const [expandedEpics, setExpandedEpics] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const tokenClientRef = useRef(null);

  // 初始化 Google Identity Services
  useEffect(() => {
    const initGis = () => {
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: DRIVE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (tokenResponse) => {
          if (tokenResponse && tokenResponse.access_token) {
            localStorage.setItem('google_drive_access_token', tokenResponse.access_token);
            alert("✅ 雲端硬碟授權成功！請再次上傳檔案。");
          }
        },
      });
    };
    if (!window.google) {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true; script.defer = true; script.onload = initGis;
      document.body.appendChild(script);
    } else { initGis(); }
  }, []);

  // 取得專案名稱
  useEffect(() => {
    if (!user || !selectedProject) return;
    const projectsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'projects');
    const unsubscribe = onSnapshot(projectsRef, (snapshot) => {
      const loadedProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const currentProject = loadedProjects.find(p => p.id === selectedProject);
      if (currentProject) setProjectName(currentProject.name);
    });
    return () => unsubscribe();
  }, [user, selectedProject]);

  // 監聽工項、檔案與【專屬人員】紀錄
  useEffect(() => {
    if (!user || !selectedProject) return;
    const tasksRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'tasks');
    const filesRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'files');
    const personnelRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'personnel');
    
    const unsubTasks = onSnapshot(tasksRef, (snapshot) => {
      const allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const projectTasks = allTasks.filter(t => t.projectId === selectedProject);
      setTasks(projectTasks);
      if (selectedTask && !isEditing) {
        const updatedSelectedTask = projectTasks.find(t => t.uid === selectedTask.uid);
        if (updatedSelectedTask) setSelectedTask(updatedSelectedTask);
      }
    });

    const unsubFiles = onSnapshot(filesRef, (snapshot) => {
      const allFiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTaskFiles(allFiles.filter(f => f.projectId === selectedProject && f.taskId));
    });

    const unsubPersonnel = onSnapshot(personnelRef, (snapshot) => {
      const allPersonnel = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPersonnel(allPersonnel.filter(p => p.projectId === selectedProject));
    });

    return () => { unsubTasks(); unsubFiles(); unsubPersonnel(); };
  }, [user, selectedProject, selectedTask, setSelectedTask, isEditing]);

  // 動態推算任務狀態 (判斷是否逾期)
  const getTaskStatus = (task) => {
    const todayStr = new Date().toISOString().split('T')[0];
    if (task.status !== 'completed' && task.due && task.due < todayStr) {
      return 'overdue';
    }
    return task.status;
  };

  const getStatusBadge = (task) => {
    const derivedStatus = getTaskStatus(task);
    
    if (derivedStatus === 'overdue') {
      return (
        <span className="px-2.5 py-1 rounded-full text-xs font-bold border whitespace-nowrap bg-red-100 text-red-700 border-red-200 dark:bg-red-500/20 dark:text-red-400 dark:border-red-500/30 animate-pulse shadow-sm">
          逾期
        </span>
      );
    }

    const styles = {
      'in-progress': 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 border-blue-200 dark:border-blue-500/30',
      'pending': 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600',
      'completed': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30'
    };
    const labels = { 'in-progress': '進行中', 'pending': '尚未開始', 'completed': '已結案' };
    return <span className={`px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${styles[task.status] || styles['pending']}`}>{labels[task.status] || '尚未開始'}</span>;
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) return <span className="ml-1 text-slate-300 dark:text-slate-600 inline-block w-3 h-3">↕</span>;
    return sortConfig.direction === 'asc' ? <span className="ml-1 text-indigo-500 inline-block">↑</span> : <span className="ml-1 text-indigo-500 inline-block">↓</span>;
  };

  const groupedTasks = React.useMemo(() => {
    let epics = tasks.filter(t => t.parentUid === 0);
    const orphanTasks = tasks.filter(t => t.parentUid !== 0 && !epics.some(e => e.uid === t.parentUid));
    if (orphanTasks.length > 0) epics.push({ uid: -1, title: '未分類獨立工項', assignee: '-', status: 'pending', parentUid: 0, isVirtual: true });

    epics.sort((a, b) => {
      let aVal = a[sortConfig.key] || '';
      let bVal = b[sortConfig.key] || '';
      if (sortConfig.key === 'period') { aVal = a.startDate || a.due || ''; bVal = b.startDate || b.due || ''; }
      if (sortConfig.key === 'status') { aVal = getTaskStatus(a); bVal = getTaskStatus(b); }
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return epics.map(epic => {
      let subTasks = epic.isVirtual ? orphanTasks : tasks.filter(t => t.parentUid === epic.uid);
      subTasks.sort((a, b) => {
        let aVal = a[sortConfig.key] || '';
        let bVal = b[sortConfig.key] || '';
        if (sortConfig.key === 'period') { aVal = a.startDate || a.due || ''; bVal = b.startDate || b.due || ''; }
        if (sortConfig.key === 'status') { aVal = getTaskStatus(a); bVal = getTaskStatus(b); }
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
      return { ...epic, subTasks };
    });
  }, [tasks, sortConfig]);

  const toggleEpicExpand = (e, uid) => {
    e.stopPropagation(); 
    setExpandedEpics(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
  };

  const handleAddTask = async (isSubTask = false, parentUid = 0) => {
    if (!user || !selectedProject) return;
    const maxUid = tasks.reduce((max, t) => Math.max(max, t.uid), 0);
    const newUid = maxUid + 1;
    let targetParentUid = parentUid;
    if (!isSubTask && parentUid === 0) targetParentUid = 0;

    const newTask = {
      uid: newUid, parentUid: targetParentUid, projectId: selectedProject,
      title: isSubTask ? '新增子任務' : '新增主模組', assignee: '',
      startDate: new Date().toISOString().split('T')[0], due: new Date().toISOString().split('T')[0],
      status: 'pending', reqDoc: false, currentProgress: '尚未開始'
    };
    try {
      await setDoc(doc(db, 'artifacts', globalAppId, 'public', 'data', 'tasks', `${selectedProject}_${newUid}`), newTask);
      if (isSubTask && !expandedEpics.includes(targetParentUid)) setExpandedEpics(prev => [...prev, targetParentUid]);
    } catch (e) { console.error("Error adding task:", e); }
  };

  const triggerFileInput = () => fileInputRef.current?.click();

  const parseCSVRow = (row) => {
    const result = []; let insideQuotes = false; let currentValue = "";
    for (let i = 0; i < row.length; i++) {
        const char = row[i];
        if (char === '"') insideQuotes = !insideQuotes;
        else if (char === ',' && !insideQuotes) { result.push(currentValue.trim()); currentValue = ""; }
        else currentValue += char;
    }
    result.push(currentValue.trim());
    return result;
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !user || !selectedProject) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      const rows = text.split('\n').filter(row => row.trim().length > 0);
      const isHeader = rows[0].includes('UID') || rows[0].includes('Parent');
      const startIndex = isHeader ? 1 : 0;

      for (let i = startIndex; i < rows.length; i++) {
        const cols = parseCSVRow(rows[i]);
        if (cols.length >= 4) {
          const uid = parseInt(cols[0], 10); const parentUid = parseInt(cols[1], 10);
          if (isNaN(uid) || isNaN(parentUid)) continue;

          // 若匯入含有 overdue 字眼，強制轉為 in-progress 或 pending 讓系統自行推算
          let importedStatus = cols[6] || 'pending';
          if (!['pending', 'in-progress', 'completed'].includes(importedStatus)) {
             importedStatus = 'pending';
          }

          const taskData = {
            uid, parentUid, projectId: selectedProject,
            title: cols[2] || '未命名', assignee: cols[3] || '',
            startDate: cols[4] || '', due: cols[5] || '', 
            status: importedStatus, currentProgress: cols[7] || '', 
            reqDoc: cols[8] === '是' || cols[8] === 'true'
          };
          const taskRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'tasks', `${selectedProject}_${uid}`);
          await setDoc(taskRef, taskData);
        }
      }
    } catch (error) { console.error("CSV 匯入失敗:", error); } 
    finally { setIsImporting(false); e.target.value = ''; }
  };

  const exportTasksToCSV = () => {
    if (!selectedProject) return;
    const csvRows = ["UID,Parent_UID,工項名稱,負責人,開始日(YYYY-MM-DD),預計完成日(YYYY-MM-DD),狀態(pending/in-progress/completed),當前進度,是否需產出文件(是/否)"];
    
    if (tasks.length === 0) {
      csvRows.push("1,0,模組一：辦公室建置與團隊管理,管理員,2026-04-01,2026-12-31,in-progress,順利進行中,否");
      csvRows.push("2,1,任務 1.1：成立專案辦公室,王主任,2026-04-01,2026-05-01,in-progress,尋找場地中,是");
    } else {
      const sortedTasks = [...tasks].sort((a, b) => a.uid - b.uid);
      sortedTasks.forEach(t => {
        const req = t.reqDoc ? "是" : "否";
        const safeTitle = `"${t.title || ''}"`;
        const safeAssignee = `"${t.assignee || ''}"`; // 避免多人指派的逗號破壞 CSV 格式
        const safeProgress = `"${t.currentProgress || ''}"`;
        csvRows.push(`${t.uid},${t.parentUid},${safeTitle},${safeAssignee},${t.startDate || ''},${t.due || ''},${t.status || ''},${safeProgress},${req}`);
      });
    }
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvRows.join("\n") + "\n"], { type: "text/csv;charset=utf-8;" }); 
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `工項清單_${selectedProject}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 處理負責人勾選與取消勾選
  const handleAssigneeChange = (personName) => {
    if (!editForm) return;
    const currentAssignees = editForm.assignee ? editForm.assignee.split(',').map(s => s.trim()).filter(Boolean) : [];
    let newAssignees = [...currentAssignees];
    if (newAssignees.includes(personName)) {
      newAssignees = newAssignees.filter(n => n !== personName);
    } else {
      newAssignees.push(personName);
    }
    setEditForm({...editForm, assignee: newAssignees.join(', ')});
  };

  const handleSaveTask = async () => {
    if (!editForm) return;
    setIsSaving(true);
    try {
      const taskRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'tasks', `${selectedProject}_${editForm.uid}`);
      await updateDoc(taskRef, {
        title: editForm.title, assignee: editForm.assignee, startDate: editForm.startDate,
        due: editForm.due, status: editForm.status, currentProgress: editForm.currentProgress, reqDoc: editForm.reqDoc
      });
      
      // 若是修改母項目且人員有變更，自動連動覆蓋子項目的負責人
      if (editForm.parentUid === 0 && editForm.assignee !== selectedTask.assignee) {
        const childTasks = tasks.filter(t => t.parentUid === editForm.uid);
        for (const child of childTasks) {
          await updateDoc(doc(db, 'artifacts', globalAppId, 'public', 'data', 'tasks', `${selectedProject}_${child.uid}`), { assignee: editForm.assignee });
        }
      }
      setIsEditing(false); setSelectedTask(editForm);
    } catch (error) { console.error("更新工項失敗:", error); } 
    finally { setIsSaving(false); }
  };

  const handleTaskFileUpload = async (e, taskUid) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const currentToken = localStorage.getItem('google_drive_access_token');
    if (!currentToken) {
      alert("尚未取得 Google Drive 授權，將為您開啟驗證視窗！");
      tokenClientRef.current?.requestAccessToken();
      return;
    }

    setUploadingTaskFiles(prev => ({...prev, [taskUid]: true}));
    try {
      const pathArray = ['專案管理系統', projectName || '未命名專案', '工項與進度追蹤'];
      const todayStr = new Date().toISOString().split('T')[0];
      const autoNamedFile = `[工項文件]_${todayStr.replace(/-/g, '')}_${file.name}`;
      
      const driveRes = await uploadToGoogleDrive(file, autoNamedFile, pathArray, currentToken);
      
      const filesRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'files');
      await addDoc(filesRef, {
        projectId: selectedProject,
        taskId: taskUid,
        name: autoNamedFile,
        date: todayStr,
        createdAt: new Date().getTime(),
        url: driveRes.webViewLink || '#'
      });
    } catch (error) {
      console.error("檔案上傳失敗:", error);
      if (error.message === 'UNAUTHORIZED') {
        localStorage.removeItem('google_drive_access_token');
        alert("授權已過期，請重新上傳以觸發授權！");
      }
    } finally {
      setUploadingTaskFiles(prev => ({...prev, [taskUid]: false}));
      e.target.value = '';
    }
  };

  const renderTaskDetail = (task) => {
    const subTasks = tasks.filter(t => t.parentUid === task.uid);
    const parentEpic = task.parentUid !== 0 ? tasks.find(t => t.uid === task.parentUid) : null;
    const currentTaskFiles = taskFiles.filter(f => f.taskId === task.uid);
    const isUploading = uploadingTaskFiles[task.uid];

    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm relative overflow-hidden transition-all">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-500"></div>
          
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="flex-1 w-full">
              {parentEpic ? (
                <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mb-1 flex items-center">
                  <FolderArchive size={14} className="mr-1.5" /> 母項目：{parentEpic.title}
                </p>
              ) : (
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mb-1 flex items-center">
                  <FolderArchive size={14} className="mr-1.5" /> 此為最高層級母項目
                </p>
              )}
              
              {isEditing ? (
                <input 
                  type="text" value={editForm.title} onChange={(e) => setEditForm({...editForm, title: e.target.value})}
                  className="text-2xl font-bold text-slate-800 dark:text-white bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 w-full mt-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              ) : (
                <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center mt-1">
                  {task.title}
                  {getTaskStatus(task) === 'overdue' && <AlertCircle size={20} className="ml-3 text-red-500" title="已逾期" />}
                </h2>
              )}

              {isEditing ? (
                <div className="mt-4 flex items-center space-x-2">
                  <span className="text-sm font-bold text-slate-500">當前進度：</span>
                  <input 
                    type="text" value={editForm.currentProgress} onChange={(e) => setEditForm({...editForm, currentProgress: e.target.value})}
                    className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              ) : (
                <p className="text-slate-500 dark:text-slate-400 mt-3 flex items-center">
                  <span className="bg-slate-100 dark:bg-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium mr-3">當前進度：{task.currentProgress || '無進度說明'}</span>
                </p>
              )}
            </div>
            
            <div className="flex items-center space-x-3 mt-4 md:mt-0 flex-shrink-0">
              {isEditing ? (
                <>
                  <button onClick={() => { setIsEditing(false); setEditForm(null); }} className="px-4 py-2 bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 font-bold text-sm rounded-lg hover:bg-slate-200 transition-colors flex items-center"><X size={16} className="mr-1.5" /> 取消</button>
                  <button onClick={handleSaveTask} disabled={isSaving} className="px-4 py-2 bg-indigo-600 text-white font-bold text-sm rounded-lg hover:bg-indigo-700 shadow-sm transition-colors flex items-center">{isSaving ? <Loader2 size={16} className="animate-spin mr-1.5" /> : <Save size={16} className="mr-1.5" />} 儲存變更</button>
                </>
              ) : (
                <button onClick={() => { setEditForm({...task}); setIsEditing(true); }} className="px-4 py-2 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 font-bold text-sm rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 transition-colors flex items-center border border-indigo-200 dark:border-indigo-500/30"><Edit2 size={16} className="mr-1.5" /> 編輯與指派</button>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50">
            {/* 負責人區塊 (多選/顯示) */}
            <div>
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-wider">指派負責人</p>
              {isEditing ? (
                <div className="flex flex-col space-y-1">
                  <div className="bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg p-2 max-h-32 overflow-y-auto">
                    {personnel.length === 0 ? (
                      <span className="text-xs text-slate-500 px-1">專案無建檔人員</span>
                    ) : (
                      personnel.map(p => {
                        const isChecked = editForm.assignee?.split(',').map(s=>s.trim()).includes(p.name);
                        return (
                          <label key={p.id} className="flex items-center space-x-2 py-1.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 rounded px-2 transition-colors">
                            <input 
                              type="checkbox" 
                              checked={isChecked}
                              onChange={() => handleAssigneeChange(p.name)}
                              className="rounded text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                              {p.name} <span className="text-[10px] text-slate-400 font-normal">({p.role})</span>
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                  {editForm.parentUid === 0 && <span className="text-[10px] text-orange-500 font-bold mt-1 leading-tight">💡 儲存後將同步覆蓋底下所有子任務之負責人</span>}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-700 min-h-[42px] items-center">
                  {task.assignee ? task.assignee.split(',').map(a => a.trim()).filter(Boolean).map((assignee, i) => (
                    <div key={i} className="flex items-center space-x-1.5 bg-white dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-600 shadow-sm">
                      <div className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                        {assignee[0]}
                      </div>
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{assignee}</span>
                    </div>
                  )) : <span className="text-sm font-bold text-slate-400 pl-1">未指派</span>}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-wider">工作期間設定</p>
              {isEditing ? (
                <div className="flex flex-col space-y-2">
                  <div className="flex items-center space-x-2"><span className="text-xs text-slate-500 font-medium w-6">起</span><input type="date" value={editForm.startDate} onChange={(e) => setEditForm({...editForm, startDate: e.target.value})} className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-indigo-500" /></div>
                  <div className="flex items-center space-x-2"><span className="text-xs text-slate-500 font-medium w-6">訖</span><input type="date" value={editForm.due} onChange={(e) => setEditForm({...editForm, due: e.target.value})} className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-indigo-500" /></div>
                </div>
              ) : (
                <div className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-700"><Calendar size={14} className="mr-2 text-indigo-500" /><span className="font-mono tracking-tight">{task.startDate || '-'} ~ {task.due || '-'}</span></div>
              )}
            </div>
            
            {/* 總狀態區塊 */}
            <div>
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-wider">總狀態</p>
              {isEditing ? (
                <select value={editForm.status} onChange={(e) => setEditForm({...editForm, status: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-medium">
                  <option value="pending">尚未開始</option>
                  <option value="in-progress">進行中</option>
                  <option value="completed">已結案</option>
                </select>
              ) : (
                <div className="pt-1">{getStatusBadge(task)}</div>
              )}
            </div>

            <div>
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-wider">文件產出規定</p>
              {isEditing ? (
                <label className="flex items-center space-x-2 mt-1 cursor-pointer"><input type="checkbox" checked={editForm.reqDoc} onChange={(e) => setEditForm({...editForm, reqDoc: e.target.checked})} className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500" /><span className="text-sm font-medium text-slate-700 dark:text-slate-300">✅ 需產出並歸檔</span></label>
              ) : (
                <p className="text-sm font-bold text-slate-700 dark:text-slate-300 pt-1.5">{task.reqDoc ? '✅ 需歸檔文件' : '無特別規定'}</p>
              )}
            </div>
          </div>
        </div>

        {task.parentUid === 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/80">
              <h3 className="font-bold text-slate-800 dark:text-white flex items-center"><CheckSquare size={18} className="mr-2 text-indigo-500" /> 所屬子任務拆解清單 ({subTasks.length})</h3>
              <button onClick={() => handleAddTask(true, task.uid)} className="text-sm px-3 py-1.5 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 font-bold hover:bg-indigo-100 dark:hover:bg-indigo-500/20 rounded-lg flex items-center transition-colors border border-indigo-200 dark:border-indigo-500/30"><Plus size={16} className="mr-1"/> 新增子任務</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-3 px-6 text-xs font-bold text-slate-500">子任務名稱</th>
                    <th className="py-3 px-6 text-xs font-bold text-slate-500">負責人</th>
                    <th className="py-3 px-6 text-xs font-bold text-slate-500">工作期間</th>
                    <th className="py-3 px-6 text-xs font-bold text-slate-500 text-center">狀態</th>
                    <th className="py-3 px-6 text-xs font-bold text-slate-500 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {subTasks.length > 0 ? subTasks.map(sub => (
                    <tr key={sub.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="py-3 px-6 text-sm font-bold text-slate-800 dark:text-slate-200">
                        <div className="flex items-center">
                          {getTaskStatus(sub) === 'overdue' && <AlertCircle size={14} className="mr-1.5 text-red-500" />}
                          {sub.title}
                        </div>
                      </td>
                      <td className="py-3 px-6 text-sm font-medium text-slate-600 dark:text-slate-400">
                        <div className="flex flex-wrap gap-1">
                           {sub.assignee ? sub.assignee.split(',').map(a => a.trim()).filter(Boolean).map((a, i) => (
                             <span key={i} className="bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-xs">{a}</span>
                           )) : '-'}
                        </div>
                      </td>
                      <td className="py-3 px-6 text-xs font-mono text-slate-500 dark:text-slate-400 tracking-tight">{sub.startDate || '-'} ~ {sub.due}</td>
                      <td className="py-3 px-6 text-center">{getStatusBadge(sub)}</td>
                      <td className="py-3 px-6 text-right"><button onClick={() => setSelectedTask(sub)} className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 px-3 py-1.5 rounded-lg transition-colors">獨立維護</button></td>
                    </tr>
                  )) : (<tr><td colSpan="5" className="py-8 text-sm font-medium text-slate-500 text-center">目前尚無子任務，請點擊右上方新增。</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 檔案真實上傳區塊 */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm p-6 md:p-8">
          <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center border-b border-slate-100 dark:border-slate-700/50 pb-3">
            <FolderArchive size={18} className="mr-2 text-indigo-500" /> 此工項之相關歸檔文件
          </h3>
          
          {currentTaskFiles.length > 0 && (
            <div className="mb-6 space-y-2">
              {currentTaskFiles.map(f => (
                <div key={f.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-indigo-300 transition-colors">
                  <div className="flex items-center">
                    <FileText size={16} className="text-indigo-500 mr-3" />
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{f.name}</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-xs text-slate-400 font-mono">{f.date}</span>
                    <button onClick={() => window.open(f.url, '_blank')} className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors" title="前往 Drive 查看"><ExternalLink size={16}/></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div 
            onClick={() => document.getElementById(`task-upload-${task.uid}`).click()}
            className="border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 rounded-xl p-10 flex flex-col items-center justify-center text-center hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer group"
          >
            <input type="file" id={`task-upload-${task.uid}`} className="hidden" onChange={(e) => handleTaskFileUpload(e, task.uid)} />
            
            {isUploading ? (
              <div className="flex flex-col items-center justify-center text-indigo-500">
                <Loader2 size={32} className="animate-spin mb-3" />
                <p className="text-sm font-bold animate-pulse">檔案實體上傳與歸檔中...</p>
              </div>
            ) : (
              <>
                <div className="p-4 bg-white dark:bg-slate-800 rounded-full shadow-sm mb-3 group-hover:scale-110 transition-transform">
                  <FileText size={28} className="text-indigo-500 dark:text-indigo-400" />
                </div>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">在此拖曳或點擊上傳工項關聯文件</p>
                <p className="text-xs text-slate-500 mt-2 max-w-sm">檔案上傳後將自動綁定此任務，並真實同步至 Google Drive 空間。</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (selectedTask) return renderTaskDetail(selectedTask);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm overflow-hidden flex flex-col h-full min-h-[600px] animate-in fade-in duration-300">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/80">
        <div className="flex space-x-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="搜尋工項..." className="pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button className="p-2 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"><Filter size={18} /></button>
        </div>
        <div className="flex space-x-3">
          <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={handleFileUpload} />
          <button onClick={exportTasksToCSV} className="flex items-center space-x-2 px-4 py-2 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 rounded-lg hover:bg-indigo-100 text-sm font-medium">
            <Download size={16} /><span>匯出 CSV (含現有工項)</span>
          </button>
          <button onClick={triggerFileInput} disabled={isImporting} className="flex items-center space-x-2 px-4 py-2 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 rounded-lg hover:bg-indigo-100 text-sm font-medium">
            {isImporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            <span>匯入 CSV 更新</span>
          </button>
          <button onClick={handleAddTask} className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm text-sm font-medium">
            <Plus size={16} /><span>新增任務</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 dark:bg-slate-800/80 sticky top-0 z-10 shadow-sm">
            <tr>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" onClick={() => handleSort('title')}>任務結構與名稱 <SortIcon columnKey="title" /></th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" onClick={() => handleSort('assignee')}>負責人 <SortIcon columnKey="assignee" /></th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" onClick={() => handleSort('period')}>工作期間 <SortIcon columnKey="period" /></th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" onClick={() => handleSort('currentProgress')}>當前進度 <SortIcon columnKey="currentProgress" /></th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-center" onClick={() => handleSort('status')}>狀態 <SortIcon columnKey="status" /></th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700 text-right">詳情</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 bg-white dark:bg-slate-800">
            {groupedTasks.length === 0 ? (
              <tr>
                <td colSpan="6" className="py-16 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <FolderArchive size={48} className="text-slate-300 dark:text-slate-600 mb-4" />
                    <p className="text-slate-700 dark:text-slate-300 font-medium mb-1">此專案目前尚無從 Firebase 讀取到的工項資料</p>
                    <p className="text-slate-500 text-sm mb-6 max-w-md">您可以手動點擊右上方「新增任務」，或先匯出空白的 CSV 範例檔填寫後進行批次匯入。</p>
                    <div className="flex space-x-4">
                      <button onClick={exportTasksToCSV} className="px-4 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-medium text-sm rounded-lg hover:shadow-sm flex items-center">
                        <Download size={16} className="mr-2" />匯出空白 CSV 範例
                      </button>
                      <button onClick={triggerFileInput} disabled={isImporting} className="px-4 py-2 bg-indigo-50 text-indigo-600 font-medium text-sm rounded-lg hover:bg-indigo-100 flex items-center">
                        {isImporting ? <Loader2 size={16} className="animate-spin mr-2" /> : <FileSpreadsheet size={16} className="mr-2" />}
                        匯入 CSV 工項清單
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              groupedTasks.map(epic => {
                const isExpanded = expandedEpics.includes(epic.uid);
                const hasSubTasks = epic.subTasks && epic.subTasks.length > 0;

                return (
                  <React.Fragment key={`epic-${epic.uid}`}>
                    <tr className="hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10 cursor-pointer group" onClick={() => setSelectedTask(epic)}>
                      <td className="py-4 px-6 text-sm text-slate-500 dark:text-slate-400">
                        <div className="flex items-center">
                          <button onClick={(e) => toggleEpicExpand(e, epic.uid)} className={`mr-2 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 transition-transform ${!hasSubTasks && 'opacity-30 cursor-default'}`} disabled={!hasSubTasks}>
                            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          </button>
                          <div className="flex flex-col">
                            <span className="font-bold text-indigo-700 dark:text-indigo-400 flex items-center">
                              {getTaskStatus(epic) === 'overdue' && <AlertCircle size={14} className="mr-1.5 text-red-500" />}
                              <FolderArchive size={14} className="mr-1.5 opacity-70" />{epic.title}
                            </span>
                            {hasSubTasks && <span className="text-[10px] text-slate-400 font-medium ml-6 mt-0.5">包含 {epic.subTasks.length} 個子任務</span>}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-sm">
                        <div className="flex flex-wrap gap-1">
                           {epic.assignee ? epic.assignee.split(',').map(a => a.trim()).filter(Boolean).map((a, i) => (
                             <span key={i} className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold px-2 py-0.5 rounded text-xs">{a}</span>
                           )) : '-'}
                        </div>
                      </td>
                      <td className="py-4 px-6 text-xs font-mono tracking-tight text-slate-500 dark:text-slate-400">{epic.startDate || '-'} ~ {epic.due || '-'}</td>
                      <td className="py-4 px-6 text-sm">
                        <span className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2.5 py-1 rounded-md">{epic.currentProgress}</span>
                      </td>
                      <td className="py-4 px-6 text-center">{getStatusBadge(epic)}</td>
                      <td className="py-4 px-6 text-right">
                        <button className="text-indigo-600 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity font-medium text-sm flex items-center justify-end w-full px-2 py-1.5 bg-indigo-50 dark:bg-indigo-500/20 rounded-lg">
                          維護母模組 <ChevronRight size={16} className="ml-1" />
                        </button>
                      </td>
                    </tr>
                    {isExpanded && epic.subTasks.map(sub => (
                      <tr key={sub.id} onClick={() => setSelectedTask(sub)} className="bg-slate-50/50 dark:bg-slate-900/30 hover:bg-white dark:hover:bg-slate-800 cursor-pointer group transition-colors border-l-4 border-l-indigo-300 dark:border-l-indigo-600">
                        <td className="py-3 px-6 pl-14 text-sm font-bold text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                          <div className="flex items-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 mr-3"></div>
                            {getTaskStatus(sub) === 'overdue' && <AlertCircle size={14} className="mr-1.5 text-red-500 inline" />}
                            {sub.title}
                          </div>
                        </td>
                        <td className="py-3 px-6 text-sm">
                          <div className="flex flex-wrap gap-1">
                             {sub.assignee ? sub.assignee.split(',').map(a => a.trim()).filter(Boolean).map((a, i) => (
                               <span key={i} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold px-1.5 py-0.5 rounded text-xs">{a}</span>
                             )) : '-'}
                          </div>
                        </td>
                        <td className="py-3 px-6 text-xs font-mono tracking-tight text-slate-500 dark:text-slate-400">{sub.startDate || '-'} ~ {sub.due || '-'}</td>
                        <td className="py-3 px-6 text-sm"><span className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 px-2.5 py-1 rounded-md font-medium shadow-sm">{sub.currentProgress || '-'}</span></td>
                        <td className="py-3 px-6 text-center">{getStatusBadge(sub)}</td>
                        <td className="py-3 px-6 text-right">
                          <button className="text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all font-bold text-xs flex items-center justify-end w-full">
                            獨立維護 <ChevronRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
