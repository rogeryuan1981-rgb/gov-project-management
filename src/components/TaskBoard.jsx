import React, { useState, useEffect, useRef } from 'react';
import { Search, Filter, Plus, ChevronRight, ChevronDown, AlertCircle, Calendar, FolderArchive, FileText, Download, Loader2, FileSpreadsheet, Edit2, Save, X, Trash2 } from 'lucide-react';
import { collection, onSnapshot, doc, setDoc, updateDoc, getFirestore } from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';

const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

export default function TaskBoard({ user, selectedProject, selectedTask, setSelectedTask }) {
  const [tasks, setTasks] = useState([]);
  const fileInputRef = useRef(null);
  const [isImporting, setIsImporting] = useState(false);

  // 排序狀態
  const [sortConfig, setSortConfig] = useState({ key: 'uid', direction: 'asc' });
  // 展開的母項目 UID 陣列
  const [expandedEpics, setExpandedEpics] = useState([]);
  // 編輯模式狀態 (工項詳細畫面)
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // 監聽 Firebase 資料庫中的工項 (依照選取的專案 UID 過濾)
  useEffect(() => {
    if (!user || !selectedProject) return;

    const tasksRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'tasks');
    
    const unsubscribe = onSnapshot(tasksRef, (snapshot) => {
      const allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const projectTasks = allTasks.filter(t => t.projectId === selectedProject);
      
      setTasks(projectTasks);

      // 若有正在查看的工項，確保資料即時更新
      if (selectedTask && !isEditing) {
        const updatedSelectedTask = projectTasks.find(t => t.uid === selectedTask.uid);
        if (updatedSelectedTask) setSelectedTask(updatedSelectedTask);
      }
    }, (error) => {
      console.error("Firestore listen error:", error);
    });

    return () => unsubscribe();
  }, [user, selectedProject, selectedTask, setSelectedTask, isEditing]);

  // 排序處理函式
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) return <span className="ml-1 text-slate-300 dark:text-slate-600 inline-block w-3 h-3">↕</span>;
    return sortConfig.direction === 'asc' 
      ? <span className="ml-1 text-indigo-500 inline-block">↑</span> 
      : <span className="ml-1 text-indigo-500 inline-block">↓</span>;
  };

  // 根據 UID/Parent_UID 轉換顯示用的三層資料結構，並進行排序
  const groupedTasks = React.useMemo(() => {
    let epics = tasks.filter(t => t.parentUid === 0);
    
    // 將孤兒任務轉為獨立的虛擬母項目 (防呆)
    const orphanTasks = tasks.filter(t => t.parentUid !== 0 && !epics.some(e => e.uid === t.parentUid));
    if (orphanTasks.length > 0) {
      epics.push({ uid: -1, title: '未分類獨立工項', assignee: '-', status: 'pending', parentUid: 0, isVirtual: true });
    }

    // 第一層：母項目排序
    epics.sort((a, b) => {
      let aVal = a[sortConfig.key] || '';
      let bVal = b[sortConfig.key] || '';
      if (sortConfig.key === 'period') {
        aVal = a.startDate || a.due || '';
        bVal = b.startDate || b.due || '';
      }
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return epics.map(epic => {
      let subTasks = epic.isVirtual 
        ? orphanTasks 
        : tasks.filter(t => t.parentUid === epic.uid);
      
      // 第二層：子任務排序
      subTasks.sort((a, b) => {
        let aVal = a[sortConfig.key] || '';
        let bVal = b[sortConfig.key] || '';
        if (sortConfig.key === 'period') {
          aVal = a.startDate || a.due || '';
          bVal = b.startDate || b.due || '';
        }
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });

      return { ...epic, subTasks };
    });
  }, [tasks, sortConfig]);

  // 摺疊/展開母項目
  const toggleEpicExpand = (e, uid) => {
    e.stopPropagation(); // 避免觸發進入詳細頁面
    setExpandedEpics(prev => 
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  // 單筆新增任務 (自動取得最新 UID 續編)
  const handleAddTask = async (isSubTask = false, parentUid = 0) => {
    if (!user || !selectedProject) return;
    
    const maxUid = tasks.reduce((max, t) => Math.max(max, t.uid), 0);
    const newUid = maxUid + 1;
    
    let targetParentUid = parentUid;
    
    // 如果是新增母項目，且尚未有任何母項目
    if (!isSubTask && parentUid === 0) {
       targetParentUid = 0;
    }

    const newTask = {
      uid: newUid,
      parentUid: targetParentUid,
      projectId: selectedProject,
      title: isSubTask ? '新增子任務' : '新增主模組',
      assignee: '未指派',
      startDate: new Date().toISOString().split('T')[0],
      due: new Date().toISOString().split('T')[0],
      status: 'pending',
      reqDoc: false,
      currentProgress: '尚未開始'
    };

    try {
      await setDoc(doc(db, 'artifacts', globalAppId, 'public', 'data', 'tasks', `${selectedProject}_${newUid}`), newTask);
      // 如果是在展開狀態下新增子任務，確保母項目有展開
      if (isSubTask && !expandedEpics.includes(targetParentUid)) {
        setExpandedEpics(prev => [...prev, targetParentUid]);
      }
    } catch (e) {
      console.error("Error adding task:", e);
    }
  };

  const triggerFileInput = () => fileInputRef.current?.click();

  const parseCSVRow = (row) => {
    const result = [];
    let insideQuotes = false;
    let currentValue = "";
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

      let importCount = 0;
      for (let i = startIndex; i < rows.length; i++) {
        const cols = parseCSVRow(rows[i]);
        if (cols.length >= 4) { // 確保有足夠欄位
          const uid = parseInt(cols[0], 10);
          const parentUid = parseInt(cols[1], 10);
          if (isNaN(uid) || isNaN(parentUid)) continue;

          const taskData = {
            uid, parentUid, projectId: selectedProject,
            title: cols[2] || '未命名', 
            assignee: cols[3] || '未指派',
            startDate: cols[4] || '',  // 新增開始日
            due: cols[5] || '', 
            status: cols[6] || 'pending',
            currentProgress: cols[7] || '', 
            reqDoc: cols[8] === '是' || cols[8] === 'true'
          };
          
          const taskRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'tasks', `${selectedProject}_${uid}`);
          await setDoc(taskRef, taskData);
          importCount++;
        }
      }
      console.log(`成功匯入並更新 ${importCount} 筆工項資料`);
    } catch (error) {
      console.error("CSV 匯入失敗:", error);
    } finally {
      setIsImporting(false);
      e.target.value = ''; 
    }
  };

  const exportTasksToCSV = () => {
    if (!selectedProject) return;
    
    const csvRows = [
      "UID,Parent_UID,工項名稱,負責人,開始日(YYYY-MM-DD),預計完成日(YYYY-MM-DD),狀態(pending/in-progress/completed/overdue),當前進度,是否需產出文件(是/否)"
    ];
    
    if (tasks.length === 0) {
      csvRows.push("1,0,模組一：辦公室建置與團隊管理,管理員,2026-04-01,2026-12-31,in-progress,順利進行中,否");
      csvRows.push("2,1,任務 1.1：成立專案辦公室,王主任,2026-04-01,2026-05-01,in-progress,尋找場地中,是");
      csvRows.push("3,1,尋找合適場地(距署內30分),李助理,2026-04-01,2026-04-15,completed,已完成,否");
    } else {
      const sortedTasks = [...tasks].sort((a, b) => a.uid - b.uid);
      sortedTasks.forEach(t => {
        const req = t.reqDoc ? "是" : "否";
        const safeTitle = `"${t.title || ''}"`;
        const safeProgress = `"${t.currentProgress || ''}"`;
        csvRows.push(`${t.uid},${t.parentUid},${safeTitle},${t.assignee || ''},${t.startDate || ''},${t.due || ''},${t.status || ''},${safeProgress},${req}`);
      });
    }
    
    const csvContent = csvRows.join("\n") + "\n";
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" }); 
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `工項清單_${selectedProject}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusBadge = (status) => {
    const styles = {
      'overdue': 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400 border-red-200 dark:border-red-500/30',
      'in-progress': 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 border-blue-200 dark:border-blue-500/30',
      'pending': 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600',
      'completed': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30'
    };
    const labels = { 'overdue': '已逾期', 'in-progress': '進行中', 'pending': '待處理', 'completed': '已完成' };
    return <span className={`px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${styles[status] || styles['pending']}`}>{labels[status] || '待處理'}</span>;
  };

  // 儲存工項維護 (包含負責人向下連動更新)
  const handleSaveTask = async () => {
    if (!editForm) return;
    setIsSaving(true);
    try {
      const taskRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'tasks', `${selectedProject}_${editForm.uid}`);
      await updateDoc(taskRef, {
        title: editForm.title,
        assignee: editForm.assignee,
        startDate: editForm.startDate,
        due: editForm.due,
        status: editForm.status,
        currentProgress: editForm.currentProgress,
        reqDoc: editForm.reqDoc
      });

      // 【核心功能】：若此項目為「母項目 (Epic)」，且負責人被更改了，則向下更新所有子項目的負責人
      if (editForm.parentUid === 0 && editForm.assignee !== selectedTask.assignee) {
        const childTasks = tasks.filter(t => t.parentUid === editForm.uid);
        for (const child of childTasks) {
          const childRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'tasks', `${selectedProject}_${child.uid}`);
          await updateDoc(childRef, { assignee: editForm.assignee });
        }
        alert(`✅ 母項目負責人已更新，並成功連動更新其底下的 ${childTasks.length} 個子項目！`);
      }

      setIsEditing(false);
      setSelectedTask(editForm); // 更新當前預覽視圖
    } catch (error) {
      console.error("更新工項失敗:", error);
      alert("儲存失敗，請檢查網路連線或權限。");
    } finally {
      setIsSaving(false);
    }
  };

  // ================= 渲染工項詳細與維護視圖 =================
  const renderTaskDetail = (task) => {
    // 找出其子任務
    const subTasks = tasks.filter(t => t.parentUid === task.uid);
    // 找出其母任務 (如果它是子任務的話)
    const parentEpic = task.parentUid !== 0 ? tasks.find(t => t.uid === task.parentUid) : null;

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
                  type="text" 
                  value={editForm.title} 
                  onChange={(e) => setEditForm({...editForm, title: e.target.value})}
                  className="text-2xl font-bold text-slate-800 dark:text-white bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 w-full mt-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              ) : (
                <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center mt-1">
                  {task.title}
                  {task.status === 'overdue' && <AlertCircle size={20} className="ml-3 text-red-500" title="已逾期" />}
                </h2>
              )}

              {isEditing ? (
                <div className="mt-4 flex items-center space-x-2">
                  <span className="text-sm font-bold text-slate-500">當前進度：</span>
                  <input 
                    type="text" 
                    value={editForm.currentProgress} 
                    onChange={(e) => setEditForm({...editForm, currentProgress: e.target.value})}
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
                  <button onClick={() => { setIsEditing(false); setEditForm(null); }} className="px-4 py-2 bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 font-bold text-sm rounded-lg hover:bg-slate-200 transition-colors flex items-center">
                    <X size={16} className="mr-1.5" /> 取消
                  </button>
                  <button onClick={handleSaveTask} disabled={isSaving} className="px-4 py-2 bg-indigo-600 text-white font-bold text-sm rounded-lg hover:bg-indigo-700 shadow-sm transition-colors flex items-center">
                    {isSaving ? <Loader2 size={16} className="animate-spin mr-1.5" /> : <Save size={16} className="mr-1.5" />} 
                    儲存變更
                  </button>
                </>
              ) : (
                <button onClick={() => { setEditForm({...task}); setIsEditing(true); }} className="px-4 py-2 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 font-bold text-sm rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 transition-colors flex items-center border border-indigo-200 dark:border-indigo-500/30">
                  <Edit2 size={16} className="mr-1.5" /> 編輯與指派
                </button>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50">
            <div>
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-wider">指派負責人</p>
              {isEditing ? (
                <div className="flex flex-col space-y-1">
                  <input 
                    type="text" 
                    value={editForm.assignee} 
                    onChange={(e) => setEditForm({...editForm, assignee: e.target.value})}
                    placeholder="輸入姓名"
                    className="bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {editForm.parentUid === 0 && (
                    <span className="text-[10px] text-orange-500 font-bold mt-1 leading-tight">💡 儲存後將同步更新底下所有子任務之負責人</span>
                  )}
                </div>
              ) : (
                <div className="flex items-center space-x-2 bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-700">
                  <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-xs font-bold text-indigo-700 dark:text-indigo-300">
                    {task.assignee ? task.assignee[0] : '?'}
                  </div>
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{task.assignee}</span>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-wider">工作期間設定</p>
              {isEditing ? (
                <div className="flex flex-col space-y-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-slate-500 font-medium w-6">起</span>
                    <input type="date" value={editForm.startDate} onChange={(e) => setEditForm({...editForm, startDate: e.target.value})} className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-slate-500 font-medium w-6">訖</span>
                    <input type="date" value={editForm.due} onChange={(e) => setEditForm({...editForm, due: e.target.value})} className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
              ) : (
                <div className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-700">
                  <Calendar size={14} className="mr-2 text-indigo-500" />
                  <span className="font-mono tracking-tight">{task.startDate || '-'} ~ {task.due || '-'}</span>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-wider">總狀態</p>
              {isEditing ? (
                <select 
                  value={editForm.status} 
                  onChange={(e) => setEditForm({...editForm, status: e.target.value})}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="pending">待處理</option>
                  <option value="in-progress">進行中</option>
                  <option value="completed">已完成</option>
                  <option value="overdue">已逾期</option>
                </select>
              ) : (
                <div className="pt-1">{getStatusBadge(task.status)}</div>
              )}
            </div>

            <div>
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-2 uppercase tracking-wider">文件產出規定</p>
              {isEditing ? (
                <label className="flex items-center space-x-2 mt-1 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={editForm.reqDoc} 
                    onChange={(e) => setEditForm({...editForm, reqDoc: e.target.checked})}
                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                  />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">✅ 需產出並歸檔</span>
                </label>
              ) : (
                <p className="text-sm font-bold text-slate-700 dark:text-slate-300 pt-1.5">{task.reqDoc ? '✅ 需歸檔文件' : '無特別規定'}</p>
              )}
            </div>
          </div>
        </div>

        {/* 只有母項目才顯示子任務清單 */}
        {task.parentUid === 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/80">
              <h3 className="font-bold text-slate-800 dark:text-white flex items-center">
                <CheckSquare size={18} className="mr-2 text-indigo-500" />
                所屬子任務拆解清單 ({subTasks.length})
              </h3>
              <button 
                onClick={() => handleAddTask(true, task.uid)}
                className="text-sm px-3 py-1.5 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 font-bold hover:bg-indigo-100 dark:hover:bg-indigo-500/20 rounded-lg flex items-center transition-colors border border-indigo-200 dark:border-indigo-500/30"
              >
                <Plus size={16} className="mr-1"/> 新增子任務
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-3 px-6 text-xs font-bold text-slate-500">子任務名稱</th>
                    <th className="py-3 px-6 text-xs font-bold text-slate-500">負責人</th>
                    <th className="py-3 px-6 text-xs font-bold text-slate-500">工作期間</th>
                    <th className="py-3 px-6 text-xs font-bold text-slate-500">狀態</th>
                    <th className="py-3 px-6 text-xs font-bold text-slate-500 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {subTasks.length > 0 ? subTasks.map(sub => (
                    <tr key={sub.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="py-3 px-6 text-sm font-bold text-slate-800 dark:text-slate-200">{sub.title}</td>
                      <td className="py-3 px-6 text-sm font-medium text-slate-600 dark:text-slate-400">{sub.assignee}</td>
                      <td className="py-3 px-6 text-xs font-mono text-slate-500 dark:text-slate-400 tracking-tight">{sub.startDate || '-'} ~ {sub.due}</td>
                      <td className="py-3 px-6">{getStatusBadge(sub.status)}</td>
                      <td className="py-3 px-6 text-right">
                        <button 
                          onClick={() => setSelectedTask(sub)}
                          className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          維護
                        </button>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="5" className="py-8 text-sm font-medium text-slate-500 text-center">目前尚無子任務，請點擊右上方新增。</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 檔案上傳區塊 */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm p-6 md:p-8">
          <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center border-b border-slate-100 dark:border-slate-700/50 pb-3">
            <FolderArchive size={18} className="mr-2 text-indigo-500" /> 此工項之相關歸檔文件
          </h3>
          <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 rounded-xl p-10 flex flex-col items-center justify-center text-center hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer group">
            <div className="p-4 bg-white dark:bg-slate-800 rounded-full shadow-sm mb-3 group-hover:scale-110 transition-transform">
              <FileText size={28} className="text-indigo-500 dark:text-indigo-400" />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">在此拖曳上傳工項關聯文件</p>
            <p className="text-xs text-slate-500 mt-2 max-w-sm">請注意，檔案上傳後將會自動同步至 Google Drive 雲端空間，並與此任務綁定。</p>
            <button className="mt-5 px-6 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-sm font-bold text-slate-700 dark:text-slate-300 rounded-lg hover:shadow-md transition-all">選擇檔案上傳</button>
          </div>
        </div>
      </div>
    );
  };

  // 渲染清單視圖
  if (selectedTask) {
    return renderTaskDetail(selectedTask);
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm overflow-hidden flex flex-col h-full min-h-[600px] animate-in fade-in duration-300">
      
      {/* 頂部工具列 */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700/50 flex flex-col md:flex-row md:items-center justify-between bg-slate-50/50 dark:bg-slate-800/80 gap-4">
        <div className="flex space-x-2 w-full md:w-auto">
          <div className="relative flex-1 md:flex-none md:w-64">
            <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="搜尋工項..." className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button className="p-2 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors">
            <Filter size={18} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={handleFileUpload} />
          <button onClick={exportTasksToCSV} className="flex items-center space-x-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:shadow-sm text-xs font-bold transition-all">
            <Download size={14} className="text-indigo-500" /><span>匯出 CSV</span>
          </button>
          <button onClick={triggerFileInput} disabled={isImporting} className="flex items-center space-x-2 px-4 py-2 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 text-xs font-bold transition-colors">
            {isImporting ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            <span>匯入/更新</span>
          </button>
          <button onClick={() => handleAddTask(false, 0)} className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm text-xs font-bold transition-colors">
            <Plus size={14} /><span>新增母模組</span>
          </button>
        </div>
      </div>

      {/* 階層化資料表 */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 dark:bg-slate-800/80 sticky top-0 z-10 shadow-sm">
            <tr>
              <th 
                className="py-3 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700 cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                onClick={() => handleSort('title')}
              >
                任務結構與名稱 <SortIcon columnKey="title" />
              </th>
              <th 
                className="py-3 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700 cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                onClick={() => handleSort('assignee')}
              >
                負責人 <SortIcon columnKey="assignee" />
              </th>
              <th 
                className="py-3 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700 cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                onClick={() => handleSort('period')}
              >
                工作期間 <SortIcon columnKey="period" />
              </th>
              <th 
                className="py-3 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700 cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                onClick={() => handleSort('currentProgress')}
              >
                當前進度 <SortIcon columnKey="currentProgress" />
              </th>
              <th 
                className="py-3 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700 cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-center"
                onClick={() => handleSort('status')}
              >
                狀態 <SortIcon columnKey="status" />
              </th>
              <th className="py-3 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase border-b border-slate-200 dark:border-slate-700 text-right">詳情</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 bg-white dark:bg-slate-800">
            {groupedTasks.length === 0 ? (
              <tr>
                <td colSpan="6" className="py-16 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <FolderArchive size={48} className="text-slate-300 dark:text-slate-600 mb-4" />
                    <p className="text-slate-700 dark:text-slate-300 font-bold mb-1">此專案目前尚無工項資料</p>
                    <p className="text-slate-500 text-sm mb-6 max-w-md font-medium">請點擊上方「新增母模組」，或匯出 CSV 填寫後進行批次匯入。</p>
                  </div>
                </td>
              </tr>
            ) : (
              groupedTasks.map(epic => {
                const isExpanded = expandedEpics.includes(epic.uid);
                const hasSubTasks = epic.subTasks && epic.subTasks.length > 0;

                return (
                  <React.Fragment key={`epic-${epic.uid}`}>
                    {/* 母項目 Row */}
                    <tr 
                      className="hover:bg-indigo-50/30 dark:hover:bg-indigo-500/5 cursor-pointer group transition-colors"
                      onClick={() => setSelectedTask(epic)}
                    >
                      <td className="py-4 px-6">
                        <div className="flex items-center">
                          {/* 摺疊展開按鈕 */}
                          <button 
                            onClick={(e) => toggleEpicExpand(e, epic.uid)}
                            className={`mr-2 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 transition-transform ${!hasSubTasks && 'opacity-30 cursor-default'}`}
                            disabled={!hasSubTasks}
                          >
                            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          </button>
                          
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400 flex items-center">
                              {epic.status === 'overdue' && <AlertCircle size={14} className="mr-1.5 text-red-500" />}
                              <FolderArchive size={14} className="mr-1.5 opacity-70" />
                              {epic.title}
                            </span>
                            {hasSubTasks && (
                              <span className="text-[10px] text-slate-400 font-medium ml-6 mt-0.5">包含 {epic.subTasks.length} 個子任務</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-sm font-bold text-slate-700 dark:text-slate-300">{epic.assignee || '-'}</td>
                      <td className="py-4 px-6 text-xs font-mono tracking-tight text-slate-500 dark:text-slate-400">{epic.startDate || '-'} ~ {epic.due || '-'}</td>
                      <td className="py-4 px-6 text-sm"><span className="text-slate-600 dark:text-slate-300 font-medium">{epic.currentProgress || '-'}</span></td>
                      <td className="py-4 px-6 text-center">{getStatusBadge(epic.status)}</td>
                      <td className="py-4 px-6 text-right">
                        <button className="text-indigo-600 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity font-bold text-xs flex items-center justify-end w-full px-2 py-1.5 bg-indigo-50 dark:bg-indigo-500/20 rounded-lg">
                          維護母模組 <ChevronRight size={14} className="ml-1" />
                        </button>
                      </td>
                    </tr>

                    {/* 子任務 Rows (若展開) */}
                    {isExpanded && epic.subTasks.map(sub => (
                      <tr 
                        key={sub.id} 
                        onClick={() => setSelectedTask(sub)} 
                        className="bg-slate-50/50 dark:bg-slate-900/30 hover:bg-white dark:hover:bg-slate-800 cursor-pointer group transition-colors border-l-4 border-l-indigo-300 dark:border-l-indigo-600"
                      >
                        <td className="py-3 px-6 pl-14">
                          <div className="flex items-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 mr-3"></div>
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                              {sub.status === 'overdue' && <AlertCircle size={14} className="mr-1.5 text-red-500 inline" />}
                              {sub.title}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-6 text-sm">
                          <div className="flex items-center space-x-2">
                            <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-600 dark:text-slate-300">{sub.assignee ? sub.assignee[0] : '?'}</div>
                            <span className="text-slate-600 dark:text-slate-300 font-medium">{sub.assignee}</span>
                          </div>
                        </td>
                        <td className="py-3 px-6 text-xs font-mono tracking-tight text-slate-500 dark:text-slate-400">{sub.startDate || '-'} ~ {sub.due || '-'}</td>
                        <td className="py-3 px-6 text-sm"><span className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 px-2.5 py-1 rounded-md font-medium shadow-sm">{sub.currentProgress || '-'}</span></td>
                        <td className="py-3 px-6 text-center">{getStatusBadge(sub.status)}</td>
                        <td className="py-3 px-6 text-right">
                          <button className="text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all font-bold text-xs flex items-center justify-end w-full">
                            詳細 <ChevronRight size={14} />
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
