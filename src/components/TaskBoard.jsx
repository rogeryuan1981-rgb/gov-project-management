import React, { useState, useEffect, useRef } from 'react';
import { Search, Filter, Plus, ChevronRight, ChevronDown, AlertCircle, Calendar, FolderArchive, FileText, Download, Loader2, FileSpreadsheet, Edit2, Save, X, Trash2, ExternalLink, CheckSquare, BarChart2 } from 'lucide-react';
import { collection, onSnapshot, doc, setDoc, updateDoc, getFirestore, addDoc } from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';

const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

// 移除會造成編譯警告的 import.meta，直接使用安全的公開 Client ID
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
  const [personnel, setPersonnel] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [projectStartDate, setProjectStartDate] = useState('');
  const [projectEndDate, setProjectEndDate] = useState('');
  const [taskFiles, setTaskFiles] = useState([]);
  const fileInputRef = useRef(null);
  
  const [isImporting, setIsImporting] = useState(false);
  const [uploadingTaskFiles, setUploadingTaskFiles] = useState({});

  const [sortConfig, setSortConfig] = useState({ key: 'uid', direction: 'asc' });
  const [expandedEpics, setExpandedEpics] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // 甘特圖勾選狀態與模式
  const [isGanttMode, setIsGanttMode] = useState(false);
  const [selectedForGantt, setSelectedForGantt] = useState([]);

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

  // 取得專案名稱與專案起迄日 (供甘特圖極限範圍使用)
  useEffect(() => {
    if (!user || !selectedProject) return;
    const projectsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'projects');
    const unsubscribe = onSnapshot(projectsRef, (snapshot) => {
      const loadedProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const currentProject = loadedProjects.find(p => p.id === selectedProject);
      if (currentProject) {
        setProjectName(currentProject.name);
        setProjectStartDate(currentProject.startDate || '');
        setProjectEndDate(currentProject.endDate || '');
      }
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

  // ================= 核心邏輯：自動同步母子模組狀態與結案日 =================
  useEffect(() => {
    if (tasks.length === 0) return;
    
    tasks.filter(t => t.parentUid === 0).forEach(epic => {
      const subTasks = tasks.filter(t => t.parentUid === epic.uid);
      if (subTasks.length > 0) {
        const allCompleted = subTasks.every(t => t.status === 'completed');
        const anyActive = subTasks.some(t => t.status === 'in-progress' || t.status === 'completed');
        
        let expectedStatus = epic.status;
        let expectedCompletedDate = epic.completedDate;
        
        if (allCompleted) {
          expectedStatus = 'completed';
          // 取所有子工項中最晚的結案日期
          const latestCompletedDate = subTasks.reduce((latest, sub) => {
            if (!sub.completedDate) return latest;
            if (!latest) return sub.completedDate;
            return new Date(sub.completedDate) > new Date(latest) ? sub.completedDate : latest;
          }, '');
          expectedCompletedDate = latestCompletedDate;
        } else if (anyActive) {
          expectedStatus = 'in-progress';
          expectedCompletedDate = ''; // 未全結案時清空母工項結案日
        } else {
          expectedStatus = 'pending';
          expectedCompletedDate = '';
        }

        if (epic.status !== expectedStatus || epic.completedDate !== expectedCompletedDate) {
          const taskRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'tasks', `${selectedProject}_${epic.uid}`);
          updateDoc(taskRef, { 
            status: expectedStatus,
            completedDate: expectedCompletedDate 
          }).catch(e => console.error(e));
        }
      }
    });
  }, [tasks, selectedProject]);

  // 判斷是否為「缺件」工項 (僅在狀態為結案時判斷)
  const isMissingFile = (task) => {
    if (!task.reqDoc || task.status !== 'completed') return false; 
    const filesCount = taskFiles.filter(f => f.taskId === task.uid).length;
    return filesCount === 0;
  };

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
      startDate: new Date().toISOString().split('T')[0], due: new Date().toISOString().split('T')[0], completedDate: '',
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

          let importedStatus = cols[7] || 'pending';
          if (!['pending', 'in-progress', 'completed'].includes(importedStatus)) {
             importedStatus = 'pending';
          }

          const taskData = {
            uid, parentUid, projectId: selectedProject,
            title: cols[2] || '未命名', assignee: cols[3] || '',
            startDate: cols[4] || '', due: cols[5] || '', completedDate: cols[6] || '',
            status: importedStatus, currentProgress: cols[8] || '', 
            reqDoc: cols[9] === '是' || cols[9] === 'true'
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
    const csvRows = ["UID,Parent_UID,工項名稱,負責人,開始日(YYYY-MM-DD),預計完成日(YYYY-MM-DD),結案日期(YYYY-MM-DD),狀態(pending/in-progress/completed),當前進度,是否需產出文件(是/否)"];
    
    if (tasks.length === 0) {
      csvRows.push("1,0,模組一：辦公室建置與團隊管理,管理員,2026-04-01,2026-12-31,,in-progress,順利進行中,否");
      csvRows.push("2,1,任務 1.1：成立專案辦公室,王主任,2026-04-01,2026-05-01,,in-progress,尋找場地中,是");
    } else {
      const sortedTasks = [...tasks].sort((a, b) => a.uid - b.uid);
      sortedTasks.forEach(t => {
        const req = t.reqDoc ? "是" : "否";
        const safeTitle = `"${t.title || ''}"`;
        const safeAssignee = `"${t.assignee || ''}"`; 
        const safeProgress = `"${t.currentProgress || ''}"`;
        csvRows.push(`${t.uid},${t.parentUid},${safeTitle},${safeAssignee},${t.startDate || ''},${t.due || ''},${t.completedDate || ''},${t.status || ''},${safeProgress},${req}`);
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

  // ================= 產出甘特圖邏輯 (優化排版與自動全選) =================
  const handleSelectAllForGantt = (e) => {
    if (e.target.checked) {
      setSelectedForGantt(tasks.map(t => t.uid));
    } else {
      setSelectedForGantt([]);
    }
  };

  const toggleSelectGantt = (e, task) => {
    e.stopPropagation();
    const isEpic = task.parentUid === 0;
    
    if (selectedForGantt.includes(task.uid)) {
      // 取消勾選
      if (isEpic) {
         // 一併取消子任務
         const subIds = tasks.filter(t => t.parentUid === task.uid).map(t => t.uid);
         setSelectedForGantt(prev => prev.filter(id => id !== task.uid && !subIds.includes(id)));
      } else {
         setSelectedForGantt(prev => prev.filter(id => id !== task.uid));
      }
    } else {
      // 勾選
      if (isEpic) {
         // 一併勾選子任務
         const subIds = tasks.filter(t => t.parentUid === task.uid).map(t => t.uid);
         setSelectedForGantt(prev => [...new Set([...prev, task.uid, ...subIds])]);
      } else {
         setSelectedForGantt(prev => [...prev, task.uid]);
      }
    }
  };

  const getGanttColor = (t) => {
    const status = getTaskStatus(t);
    if (status === 'completed') return '#10b981'; // Emerald
    if (status === 'overdue') return '#ef4444'; // Red
    if (status === 'in-progress') return '#3b82f6'; // Blue
    return '#cbd5e1'; // Slate (Pending)
  };

  const exportGanttPDF = () => {
    if (selectedForGantt.length === 0) {
      alert("請先勾選欲產出甘特圖的工項");
      return;
    }
    
    // 扁平化並過濾選取的任務
    const orderedTasks = [];
    groupedTasks.forEach(epic => {
       if (selectedForGantt.includes(epic.uid)) orderedTasks.push(epic);
       epic.subTasks.forEach(sub => {
          if (selectedForGantt.includes(sub.uid)) orderedTasks.push(sub);
       });
    });

    if (orderedTasks.length === 0) return;

    // 計算每個工項的實際期程 (推算母項目起迄)
    orderedTasks.forEach(t => {
       if (t.parentUid === 0) {
          const subs = tasks.filter(sub => sub.parentUid === t.uid);
          if (subs.length > 0) {
             const minS = Math.min(...subs.map(s => new Date(s.startDate||'9999-12-31').getTime()));
             const maxE = Math.max(...subs.map(s => {
                let e = s.status === 'completed' && s.completedDate ? s.completedDate : s.due;
                return new Date(e||'1970-01-01').getTime();
             }));
             t.derivedStart = minS !== new Date('9999-12-31').getTime() ? new Date(minS).toISOString().split('T')[0] : t.startDate;
             t.derivedEnd = maxE !== new Date('1970-01-01').getTime() ? new Date(maxE).toISOString().split('T')[0] : t.due;
          } else {
             t.derivedStart = t.startDate;
             t.derivedEnd = t.status === 'completed' && t.completedDate ? t.completedDate : t.due;
          }
       } else {
          t.derivedStart = t.startDate;
          t.derivedEnd = t.status === 'completed' && t.completedDate ? t.completedDate : t.due;
       }
    });

    const validStarts = orderedTasks.map(t => new Date(t.derivedStart).getTime()).filter(x => !isNaN(x));
    const validEnds = orderedTasks.map(t => new Date(t.derivedEnd).getTime()).filter(x => !isNaN(x));

    let minMs = validStarts.length > 0 ? Math.min(...validStarts) : Date.now();
    let maxMs = validEnds.length > 0 ? Math.max(...validEnds) : Date.now();

    // 依據專案計畫起訖日進行極限範圍防呆 (Clamp)
    const pStartMs = projectStartDate ? new Date(projectStartDate).getTime() : -Infinity;
    const pEndMs = projectEndDate ? new Date(projectEndDate).getTime() : Infinity;

    minMs = Math.max(minMs, pStartMs);
    maxMs = Math.min(maxMs, pEndMs);

    // 防呆：若極限壓縮導致錯亂，給予單日區間
    if (minMs > maxMs) maxMs = minMs + 86400000;
    
    // 為求美觀，前後各加 5 天 padding (但依舊不超過專案起訖)
    minMs = Math.max(minMs - (5 * 86400000), pStartMs);
    maxMs = Math.min(maxMs + (5 * 86400000), pEndMs);

    let totalMs = maxMs - minMs;
    if (totalMs <= 0) totalMs = 86400000;

    // 產生時間軸刻度與格線 (每月1號)
    let ticksHtml = '';
    let gridHtml = '';
    let currDate = new Date(minMs);
    currDate.setDate(1); // 歸零到該月1號
    if (currDate.getTime() < minMs) currDate.setMonth(currDate.getMonth() + 1);

    while (currDate.getTime() <= maxMs) {
      const leftPct = ((currDate.getTime() - minMs) / totalMs) * 100;
      if (leftPct >= 0 && leftPct <= 100) {
        const monthStr = `${currDate.getFullYear()}/${String(currDate.getMonth()+1).padStart(2, '0')}`;
        ticksHtml += `<div class="gantt-tick" style="left: ${leftPct}%;">${monthStr}</div>`;
        gridHtml += `<div class="gantt-grid-line" style="left: ${leftPct}%;"></div>`;
      }
      currDate.setMonth(currDate.getMonth() + 1);
    }

    let rowsHtml = '';
    orderedTasks.forEach(t => {
       const tStart = new Date(t.derivedStart).getTime();
       const tEnd = new Date(t.derivedEnd).getTime();
       
       let left = ((tStart - minMs) / totalMs) * 100;
       let width = ((tEnd - tStart) / totalMs) * 100;
       
       // 防呆，若工項完全超出範圍，或極度短暫
       if (left < 0) { width += left; left = 0; }
       if (left + width > 100) { width = 100 - left; }
       width = Math.max(width, 0.5); // 至少呈現一條線

       const isEpic = t.parentUid === 0;
       const barColor = getGanttColor(t);
       const titleIndent = isEpic ? '10px' : '30px';
       const icon = isEpic ? '📁' : '↳';

       rowsHtml += `
         <div class="gantt-row">
           <div class="gantt-label" style="padding-left: ${titleIndent}">
             <div class="gantt-title">${icon} ${t.title}</div>
             <div class="gantt-subtitle">${t.assignee || '未指派'} | ${t.derivedStart} ~ ${t.derivedEnd}</div>
           </div>
           <div class="gantt-timeline">
             <div class="gantt-bar" style="left: ${left}%; width: ${width}%; background-color: ${barColor}; border-radius: ${isEpic ? '2px' : '6px'}; height: ${isEpic ? '8px' : '16px'};"></div>
           </div>
         </div>
       `;
    });

    const printContent = `
      <!DOCTYPE html>
      <html lang="zh-TW">
      <head>
        <meta charset="UTF-8">
        <title>專案甘特圖</title>
        <style>
          body { font-family: 'Helvetica Neue', Helvetica, 'PingFang TC', 'Microsoft JhengHei', sans-serif; color: #333; line-height: 1.6; padding: 20px; }
          h1 { text-align: center; color: #1e293b; margin-bottom: 5px; }
          .meta { text-align: center; color: #64748b; font-size: 14px; margin-bottom: 20px; }
          .legend { display: flex; justify-content: center; gap: 20px; margin-bottom: 20px; font-size: 12px; font-weight: bold; }
          .legend-item { display: flex; align-items: center; }
          .legend-color { width: 16px; height: 16px; border-radius: 4px; margin-right: 6px; }
          .gantt-container { border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #fff; }
          .gantt-header { display: flex; background-color: #f8fafc; border-bottom: 1px solid #cbd5e1; }
          .gantt-header-label { width: 320px; padding: 12px; font-weight: bold; color: #475569; font-size: 14px; border-right: 1px solid #cbd5e1; box-sizing: border-box; }
          .gantt-header-timeline { flex: 1; position: relative; height: 45px; background: #f1f5f9; }
          .gantt-tick { position: absolute; bottom: 5px; font-size: 11px; font-weight: bold; color: #475569; transform: translateX(-50%); }
          .gantt-row { display: flex; border-bottom: 1px solid #f1f5f9; position: relative; page-break-inside: avoid; }
          .gantt-row:last-child { border-bottom: none; }
          .gantt-label { width: 320px; padding: 10px 12px; border-right: 1px solid #cbd5e1; background-color: #fff; box-sizing: border-box; z-index: 2; }
          .gantt-title { font-weight: bold; font-size: 13px; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .gantt-subtitle { font-size: 11px; color: #64748b; margin-top: 4px; }
          .gantt-timeline { flex: 1; position: relative; background: #fff; padding: 8px 0; overflow: hidden; }
          .gantt-grid-line { position: absolute; top: 0; bottom: 0; width: 1px; background-color: #e2e8f0; z-index: 0; }
          .gantt-bar { position: absolute; top: 50%; transform: translateY(-50%); z-index: 1; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
          .print-btn { display: block; width: 200px; margin: 20px auto; padding: 10px; background: #4f46e5; color: white; text-align: center; text-decoration: none; border-radius: 5px; font-weight: bold; cursor: pointer; }
          @media print { .no-print { display: none !important; } body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="no-print text-center" style="margin-bottom:20px; background:#f0fdf4; padding:15px; border:1px solid #bbf7d0; border-radius:8px;">
          <p style="color:#15803d; font-weight:bold; margin:0 0 10px 0;">甘特圖已產生！請點擊下方按鈕儲存為 PDF。</p>
          <button class="print-btn" onclick="window.print()">列印 / 儲存為 PDF</button>
        </div>
        <h1>【${projectName}】專案進度甘特圖</h1>
        <div class="meta">期程範圍：${new Date(minMs).toISOString().split('T')[0]} 至 ${new Date(maxMs).toISOString().split('T')[0]}</div>
        
        <div class="legend">
          <div class="legend-item"><div class="legend-color" style="background:#10b981;"></div>已結案</div>
          <div class="legend-item"><div class="legend-color" style="background:#3b82f6;"></div>進行中</div>
          <div class="legend-item"><div class="legend-color" style="background:#cbd5e1;"></div>尚未開始</div>
          <div class="legend-item"><div class="legend-color" style="background:#ef4444;"></div>逾期</div>
        </div>

        <div class="gantt-container">
          <div class="gantt-header">
            <div class="gantt-header-label">工項名稱與負責人</div>
            <div class="gantt-header-timeline">
              ${ticksHtml}
            </div>
          </div>
          <div style="position: relative;">
            <div style="position: absolute; top:0; left:320px; right:0; bottom:0; z-index:0; pointer-events:none;">
              ${gridHtml}
            </div>
            ${rowsHtml}
          </div>
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '', 'width=1100,height=800');
    printWindow.document.write(printContent);
    printWindow.document.close();
    setTimeout(() => printWindow.focus(), 500);
  };

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

    // 防呆：已結案時結案日期必填
    if (editForm.status === 'completed' && (!editForm.completedDate || editForm.completedDate.trim() === '')) {
      alert("狀態為已結案時，結案日期為必填！");
      return;
    }

    setIsSaving(true);
    try {
      const taskRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'tasks', `${selectedProject}_${editForm.uid}`);
      
      // 如果狀態變更為非 completed，則清除結案日期
      let finalCompletedDate = editForm.completedDate;
      if (editForm.status !== 'completed') {
        finalCompletedDate = '';
      }

      await updateDoc(taskRef, {
        title: editForm.title, 
        assignee: editForm.assignee, 
        startDate: editForm.startDate,
        due: editForm.due, 
        completedDate: finalCompletedDate,
        status: editForm.status, 
        currentProgress: editForm.currentProgress, 
        reqDoc: editForm.reqDoc
      });
      
      // 若是修改母項目且人員有變更，自動連動覆蓋子項目的負責人
      if (editForm.parentUid === 0 && editForm.assignee !== selectedTask.assignee) {
        const childTasks = tasks.filter(t => t.parentUid === editForm.uid);
        for (const child of childTasks) {
          await updateDoc(doc(db, 'artifacts', globalAppId, 'public', 'data', 'tasks', `${selectedProject}_${child.uid}`), { assignee: editForm.assignee });
        }
      }
      setIsEditing(false); 
      setSelectedTask({...editForm, completedDate: finalCompletedDate});
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
        
        {/* 缺件大型警示橫幅 */}
        {isMissingFile(task) && (
          <div className="bg-red-50 dark:bg-red-500/10 border-2 border-red-500/50 p-4 rounded-2xl flex items-center shadow-sm animate-in slide-in-from-top-2">
            <AlertCircle size={24} className="text-red-600 dark:text-red-400 mr-3 flex-shrink-0" />
            <div>
              <h4 className="font-bold text-red-700 dark:text-red-400 text-sm">⚠️ 注意：歸檔文件缺件！</h4>
              <p className="text-xs text-red-600 dark:text-red-300 mt-1">此工項已設定為「已結案」且「需產出並歸檔文件」，但目前尚未上傳任何檔案。請盡速至下方上傳補件。</p>
            </div>
          </div>
        )}

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
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50">
            {/* 負責人區塊 (美化後的 Chip 點選介面) */}
            <div className="lg:col-span-1">
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-wider">指派負責人</p>
              {isEditing ? (
                <div className="flex flex-col space-y-1">
                  <div className="flex flex-wrap gap-2 mt-1">
                    {personnel.length === 0 ? (
                      <span className="text-xs text-slate-500 px-1">專案無建檔人員</span>
                    ) : (
                      personnel.map(p => {
                        const isChecked = editForm.assignee?.split(',').map(s=>s.trim()).includes(p.name);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => handleAssigneeChange(p.name)}
                            className={`flex items-center px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
                              isChecked 
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-500/20 dark:border-indigo-500/30 dark:text-indigo-300 shadow-sm scale-105' 
                                : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                            }`}
                          >
                            <div className={`w-2 h-2 rounded-full mr-2 transition-colors ${isChecked ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'}`}></div>
                            {p.name}
                            <span className="ml-1 opacity-60 font-normal">({p.role})</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                  {editForm.parentUid === 0 && <span className="text-[10px] text-orange-500 font-bold mt-2 leading-tight block">💡 儲存後將同步覆蓋底下所有子任務之負責人</span>}
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

            <div className="lg:col-span-2">
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-wider">工作期程與結案日</p>
              {isEditing ? (
                <div className="flex flex-col space-y-2">
                  <div className="flex items-center space-x-2"><span className="text-xs text-slate-500 font-bold w-12">開始日</span><input type="date" value={editForm.startDate} onChange={(e) => setEditForm({...editForm, startDate: e.target.value})} className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-indigo-500" /></div>
                  <div className="flex items-center space-x-2"><span className="text-xs text-slate-500 font-bold w-12">預計完成</span><input type="date" value={editForm.due} onChange={(e) => setEditForm({...editForm, due: e.target.value})} className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-indigo-500" /></div>
                  <div className="flex items-center space-x-2"><span className="text-xs text-emerald-600 font-bold w-12">結案日</span><input type="date" value={editForm.completedDate || ''} onChange={(e) => setEditForm({...editForm, completedDate: e.target.value})} className="flex-1 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-500/30 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-emerald-500" /></div>
                </div>
              ) : (
                <div className="text-sm font-bold text-slate-700 dark:text-slate-300 flex flex-col space-y-1 bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-700">
                  <span className="flex items-center text-slate-600 dark:text-slate-400 font-mono text-xs"><Calendar size={14} className="mr-2 text-indigo-500" />{task.startDate || '-'} ~ {task.due || '-'}</span>
                  {task.status === 'completed' && (
                    <span className="flex items-center text-emerald-600 dark:text-emerald-400 font-mono text-xs mt-1"><CheckCircle2 size={14} className="mr-2" />結案於：{task.completedDate || '-'}</span>
                  )}
                </div>
              )}
            </div>
            
            {/* 總狀態區塊 */}
            <div className="lg:col-span-1">
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

            <div className="lg:col-span-1">
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-wider">文件產出規定</p>
              {isEditing ? (
                <label className="flex items-center space-x-2 mt-1 cursor-pointer"><input type="checkbox" checked={editForm.reqDoc} onChange={(e) => setEditForm({...editForm, reqDoc: e.target.checked})} className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500" /><span className="text-sm font-medium text-slate-700 dark:text-slate-300">✅ 需產出並歸檔</span></label>
              ) : (
                <p className="text-sm font-bold text-slate-700 dark:text-slate-300 pt-1.5">
                  {task.reqDoc ? '✅ 需歸檔文件' : '無特別規定'}
                </p>
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
                    <th className="py-3 px-6 text-xs font-bold text-slate-500">期限與結案日</th>
                    <th className="py-3 px-6 text-xs font-bold text-slate-500 text-center">狀態</th>
                    <th className="py-3 px-6 text-xs font-bold text-slate-500 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {subTasks.length > 0 ? subTasks.map(sub => (
                    <tr key={sub.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="py-3 px-6 text-sm font-bold text-slate-800 dark:text-slate-200">
                        <div className="flex items-center">
                          {getTaskStatus(sub) === 'overdue' && <AlertCircle size={14} className="mr-1.5 text-red-500 shrink-0" />}
                          {sub.title}
                          {isMissingFile(sub) && (
                            <span className="ml-2 px-1.5 py-0.5 bg-red-100 text-red-600 text-[10px] rounded border border-red-200 shrink-0">缺件</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-6 text-sm font-medium text-slate-600 dark:text-slate-400">
                        <div className="flex flex-wrap gap-1">
                           {sub.assignee ? sub.assignee.split(',').map(a => a.trim()).filter(Boolean).map((a, i) => (
                             <span key={i} className="bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-xs">{a}</span>
                           )) : '-'}
                        </div>
                      </td>
                      <td className="py-3 px-6 text-xs font-mono text-slate-500 dark:text-slate-400 tracking-tight">
                        <div className="flex flex-col">
                          <span>{sub.startDate || '-'} ~ {sub.due}</span>
                          {sub.status === 'completed' && sub.completedDate && <span className="text-emerald-500 font-bold mt-0.5">結案: {sub.completedDate}</span>}
                        </div>
                      </td>
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
      <div className="p-4 border-b border-slate-200 dark:border-slate-700/50 flex flex-col md:flex-row md:items-center justify-between bg-slate-50/50 dark:bg-slate-800/80 gap-4">
        <div className="flex space-x-2 w-full md:w-auto">
          <div className="relative flex-1 md:flex-none md:w-64">
            <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="搜尋工項..." className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button className="p-2 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"><Filter size={18} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          
          {/* 甘特圖產出按鈕 (模式切換) */}
          {isGanttMode ? (
            <div className="flex items-center space-x-2 bg-amber-50 dark:bg-amber-500/10 p-1.5 rounded-lg border border-amber-200 dark:border-amber-500/30">
               <button 
                 onClick={exportGanttPDF} 
                 disabled={selectedForGantt.length === 0}
                 className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-md text-sm font-bold shadow-sm flex items-center transition-colors"
               >
                 <BarChart2 size={16} className="mr-1.5" /> 確定匯出 PDF
               </button>
               <button 
                 onClick={() => { setIsGanttMode(false); setSelectedForGantt([]); }} 
                 className="px-3 py-1.5 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 rounded-md text-sm font-bold transition-colors"
               >
                 取消選擇
               </button>
            </div>
          ) : (
            <button 
              onClick={() => setIsGanttMode(true)} 
              className="flex items-center space-x-2 px-4 py-2 bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-500/30 text-sm font-bold transition-colors"
            >
              <BarChart2 size={16} /><span>產出甘特圖 (PDF)</span>
            </button>
          )}
          
          <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={handleFileUpload} />
          <button onClick={exportTasksToCSV} className="flex items-center space-x-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:shadow-sm text-sm font-bold transition-all">
            <Download size={16} className="text-indigo-500" /><span>匯出 CSV</span>
          </button>
          <button onClick={triggerFileInput} disabled={isImporting} className="flex items-center space-x-2 px-4 py-2 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 text-sm font-bold transition-colors">
            {isImporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}<span>匯入/更新</span>
          </button>
          <button onClick={() => handleAddTask(false, 0)} className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm text-sm font-bold transition-colors">
            <Plus size={16} /><span>新增任務</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 dark:bg-slate-800/80 sticky top-0 z-10 shadow-sm">
            <tr>
              {isGanttMode && (
                <th className="py-3 px-4 w-12 text-center border-b border-slate-200 dark:border-slate-700">
                  <input 
                    type="checkbox" 
                    onChange={handleSelectAllForGantt}
                    checked={tasks.length > 0 && selectedForGantt.length === tasks.length}
                    className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                    title="全選產出甘特圖"
                  />
                </th>
              )}
              <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" onClick={() => handleSort('title')}>任務結構與名稱 <SortIcon columnKey="title" /></th>
              <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" onClick={() => handleSort('assignee')}>負責人 <SortIcon columnKey="assignee" /></th>
              <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" onClick={() => handleSort('period')}>工作期間 <SortIcon columnKey="period" /></th>
              <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" onClick={() => handleSort('currentProgress')}>當前進度 <SortIcon columnKey="currentProgress" /></th>
              <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-center" onClick={() => handleSort('status')}>狀態 <SortIcon columnKey="status" /></th>
              <th className="py-3 px-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700 text-right">詳情</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 bg-white dark:bg-slate-800">
            {groupedTasks.length === 0 ? (
              <tr>
                <td colSpan={isGanttMode ? 7 : 6} className="py-16 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <FolderArchive size={48} className="text-slate-300 dark:text-slate-600 mb-4" />
                    <p className="text-slate-700 dark:text-slate-300 font-bold mb-1">此專案目前尚無從 Firebase 讀取到的工項資料</p>
                    <p className="text-slate-500 text-sm mb-6 max-w-md font-medium">請點擊上方「新增任務」，或匯出 CSV 填寫後進行批次匯入。</p>
                  </div>
                </td>
              </tr>
            ) : (
              groupedTasks.map(epic => {
                const isExpanded = expandedEpics.includes(epic.uid);
                const hasSubTasks = epic.subTasks && epic.subTasks.length > 0;

                return (
                  <React.Fragment key={`epic-${epic.uid}`}>
                    <tr className="hover:bg-indigo-50/30 dark:hover:bg-indigo-500/5 cursor-pointer group transition-colors" onClick={() => setSelectedTask(epic)}>
                      {isGanttMode && (
                        <td className="py-4 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                          <input 
                            type="checkbox" 
                            checked={selectedForGantt.includes(epic.uid)}
                            onChange={(e) => toggleSelectGantt(e, epic)}
                            className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="py-4 px-4">
                        <div className="flex items-center">
                          <button onClick={(e) => toggleEpicExpand(e, epic.uid)} className={`mr-2 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 transition-transform ${!hasSubTasks && 'opacity-30 cursor-default'}`} disabled={!hasSubTasks}>
                            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          </button>
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400 flex items-center">
                              {getTaskStatus(epic) === 'overdue' && <AlertCircle size={14} className="mr-1.5 text-red-500 shrink-0" />}
                              <FolderArchive size={14} className="mr-1.5 opacity-70 shrink-0" />
                              {epic.title}
                              {isMissingFile(epic) && (
                                <span className="ml-2 px-1.5 py-0.5 bg-red-100 text-red-600 text-[10px] rounded border border-red-200 shrink-0">缺件</span>
                              )}
                            </span>
                            {hasSubTasks && <span className="text-[10px] text-slate-400 font-medium ml-6 mt-0.5">包含 {epic.subTasks.length} 個子任務</span>}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-sm">
                        <div className="flex flex-wrap gap-1">
                           {epic.assignee ? epic.assignee.split(',').map(a => a.trim()).filter(Boolean).map((a, i) => (
                             <span key={i} className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold px-2 py-0.5 rounded text-xs">{a}</span>
                           )) : '-'}
                        </div>
                      </td>
                      <td className="py-4 px-4 text-xs font-mono tracking-tight text-slate-500 dark:text-slate-400">
                        <div className="flex flex-col">
                          <span>{epic.startDate || '-'} ~ {epic.due || '-'}</span>
                          {epic.status === 'completed' && epic.completedDate && <span className="text-emerald-500 font-bold mt-0.5">結案: {epic.completedDate}</span>}
                        </div>
                      </td>
                      <td className="py-4 px-4 text-sm"><span className="text-slate-600 dark:text-slate-300 font-medium">{epic.currentProgress || '-'}</span></td>
                      <td className="py-4 px-4 text-center">{getStatusBadge(epic)}</td>
                      <td className="py-4 px-4 text-right">
                        <button className="text-indigo-600 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity font-bold text-xs flex items-center justify-end w-full px-2 py-1.5 bg-indigo-50 dark:bg-indigo-500/20 rounded-lg">
                          維護母模組 <ChevronRight size={14} className="ml-1" />
                        </button>
                      </td>
                    </tr>
                    {isExpanded && epic.subTasks.map(sub => (
                      <tr key={sub.id} onClick={() => setSelectedTask(sub)} className="bg-slate-50/50 dark:bg-slate-900/30 hover:bg-white dark:hover:bg-slate-800 cursor-pointer group transition-colors border-l-4 border-l-indigo-300 dark:border-l-indigo-600">
                        {isGanttMode && (
                          <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                            <input 
                              type="checkbox" 
                              checked={selectedForGantt.includes(sub.uid)}
                              onChange={(e) => toggleSelectGantt(e, sub)}
                              className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                            />
                          </td>
                        )}
                        <td className={`py-3 px-4 ${isGanttMode ? 'pl-8' : 'pl-14'}`}>
                          <div className="flex items-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 mr-3 shrink-0"></div>
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors flex items-center">
                              {getTaskStatus(sub) === 'overdue' && <AlertCircle size={14} className="mr-1.5 text-red-500 shrink-0" />}
                              {sub.title}
                              {isMissingFile(sub) && (
                                <span className="ml-2 px-1.5 py-0.5 bg-red-100 text-red-600 text-[10px] rounded border border-red-200 shrink-0">缺件</span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-sm">
                          <div className="flex flex-wrap gap-1">
                             {sub.assignee ? sub.assignee.split(',').map(a => a.trim()).filter(Boolean).map((a, i) => (
                               <span key={i} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold px-1.5 py-0.5 rounded text-xs">{a}</span>
                             )) : '-'}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono tracking-tight text-slate-500 dark:text-slate-400">
                          <div className="flex flex-col">
                            <span>{sub.startDate || '-'} ~ {sub.due || '-'}</span>
                            {sub.status === 'completed' && sub.completedDate && <span className="text-emerald-500 font-bold mt-0.5">結案: {sub.completedDate}</span>}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-sm"><span className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 px-2.5 py-1 rounded-md font-medium shadow-sm">{sub.currentProgress || '-'}</span></td>
                        <td className="py-3 px-4 text-center">{getStatusBadge(sub)}</td>
                        <td className="py-3 px-4 text-right">
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
