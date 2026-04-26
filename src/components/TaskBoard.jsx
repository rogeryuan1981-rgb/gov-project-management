import React, { useState, useEffect, useRef } from 'react';
import { Search, Filter, Plus, ChevronRight, AlertCircle, Calendar, FolderArchive, FileText, Download, Loader2, FileSpreadsheet } from 'lucide-react';
import { collection, onSnapshot, doc, setDoc, getFirestore } from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';

const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

export default function TaskBoard({ user, selectedProject, selectedTask, setSelectedTask }) {
  const [tasks, setTasks] = useState([]);
  const fileInputRef = useRef(null);
  const [isImporting, setIsImporting] = useState(false);

  // 監聽 Firebase 資料庫中的工項 (依照選取的專案 UID 過濾)
  useEffect(() => {
    if (!user || !selectedProject) return;

    const tasksRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'tasks');
    
    const unsubscribe = onSnapshot(tasksRef, (snapshot) => {
      const allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // 【核心修正】：改用 projectId 進行關聯過濾
      const projectTasks = allTasks.filter(t => t.projectId === selectedProject);
      
      projectTasks.sort((a, b) => new Date(a.due) - new Date(b.due));
      setTasks(projectTasks);

      // 若有正在查看的工項，確保資料即時更新
      if (selectedTask) {
        const updatedSelectedTask = projectTasks.find(t => t.uid === selectedTask.uid);
        if (updatedSelectedTask) setSelectedTask(updatedSelectedTask);
      }
    }, (error) => {
      console.error("Firestore listen error:", error);
    });

    return () => unsubscribe();
  }, [user, selectedProject, selectedTask, setSelectedTask]);

  // 根據 UID/Parent_UID 轉換顯示用的三層資料結構
  const displayTasks = React.useMemo(() => {
    const epics = tasks.filter(t => t.parentUid === 0); // 第一層：主模組
    if (epics.length === 0) {
      return tasks.map(t => ({
         ...t,
         epic: '未分類模組',
         subTasks: tasks.filter(sub => sub.parentUid === t.uid)
      })).filter(t => t.parentUid === 0); 
    }
    // 第二層與第三層組合
    return tasks
      .filter(t => t.parentUid !== 0 && epics.some(e => e.uid === t.parentUid)) // 找出主任務
      .map(t => {
         const epic = epics.find(e => e.uid === t.parentUid);
         const subTasks = tasks.filter(sub => sub.parentUid === t.uid); // 找出其下的子任務
         return { ...t, epic: epic ? epic.title : '未知模組', subTasks: subTasks };
      });
  }, [tasks]);

  // 單筆新增任務 (自動取得最新 UID 續編)
  const handleAddTask = async () => {
    if (!user || !selectedProject) return;
    
    const maxUid = tasks.reduce((max, t) => Math.max(max, t.uid), 0);
    let targetEpicUid = 1;
    const epics = tasks.filter(t => t.parentUid === 0);
    
    if (epics.length === 0) {
      await setDoc(doc(db, 'artifacts', globalAppId, 'public', 'data', 'tasks', `${selectedProject}_1`), {
        uid: 1, parentUid: 0, projectId: selectedProject, title: '新增主模組', assignee: '管理員', due: '', status: 'pending', currentProgress: '', reqDoc: false
      });
      targetEpicUid = 1;
    } else {
      targetEpicUid = epics[0].uid;
    }
    
    const newUid = maxUid < 2 ? 2 : maxUid + 1;
    const newTask = {
      uid: newUid,
      parentUid: targetEpicUid,
      projectId: selectedProject, // 【核心修正】：存入專案 UID
      title: '未命名工項',
      assignee: '未指派',
      due: new Date().toISOString().split('T')[0],
      status: 'pending',
      reqDoc: false,
      currentProgress: '尚未開始'
    };
    try {
      await setDoc(doc(db, 'artifacts', globalAppId, 'public', 'data', 'tasks', `${selectedProject}_${newUid}`), newTask);
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
        if (cols.length >= 3) {
          const uid = parseInt(cols[0], 10);
          const parentUid = parseInt(cols[1], 10);
          if (isNaN(uid) || isNaN(parentUid)) continue;

          const taskData = {
            uid, parentUid, projectId: selectedProject, // 【核心修正】：存入專案 UID
            title: cols[2] || '未命名', assignee: cols[3] || '未指派',
            due: cols[4] || '', status: cols[5] || 'pending',
            currentProgress: cols[6] || '', reqDoc: cols[7] === '是' || cols[7] === 'true'
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
    
    // 改用陣列儲存每一行，避免字串中的 \n 被 Vercel (esbuild) 解析錯誤
    const csvRows = [
      "UID,Parent_UID,工項名稱,負責人,預計完成日(YYYY-MM-DD),狀態(pending/in-progress/completed/overdue),當前進度,是否需產出文件(是/否)"
    ];
    
    if (tasks.length === 0) {
      csvRows.push("1,0,模組一：辦公室建置與團隊管理,管理員,-,-,-,否");
      csvRows.push("2,1,任務 1.1：成立專案辦公室,王主任,2026-05-01,in-progress,尋找場地中,是");
      csvRows.push("3,2,尋找合適場地(距署內30分),李助理,2026-04-15,completed,已完成,否");
      csvRows.push("4,2,簽訂租賃合約與設備採購,陳專員,2026-05-01,overdue,延遲中,否");
      csvRows.push("5,0,模組二：費用核撥與追扣,管理員,-,-,-,否");
      csvRows.push("6,5,任務 2.1：例行檢核與撥付,林組長,2026-05-15,pending,尚未開始,是");
    } else {
      const sortedTasks = [...tasks].sort((a, b) => a.uid - b.uid);
      sortedTasks.forEach(t => {
        const req = t.reqDoc ? "是" : "否";
        const safeTitle = `"${t.title || ''}"`;
        const safeProgress = `"${t.currentProgress || ''}"`;
        csvRows.push(`${t.uid},${t.parentUid},${safeTitle},${t.assignee || ''},${t.due || ''},${t.status || ''},${safeProgress},${req}`);
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
    return <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${styles[status]}`}>{labels[status]}</span>;
  };

  const renderTaskDetail = (task) => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-500"></div>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400 mb-1">{task.epic}</p>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center">
              {task.title}
              {task.status === 'overdue' && <AlertCircle size={20} className="ml-3 text-red-500" />}
            </h2>
            <p className="text-slate-500 dark:text-slate-400 mt-2 flex items-center">
              <span className="bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded-md text-sm font-medium mr-3">當前進度：{task.currentProgress}</span>
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <button className="px-4 py-2 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 font-medium text-sm rounded-lg hover:bg-indigo-100 transition-colors">編輯工項</button>
            <button className="px-4 py-2 bg-indigo-600 text-white font-medium text-sm rounded-lg hover:bg-indigo-700 shadow-sm transition-colors">更新進度</button>
          </div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50">
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">負責人</p>
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center text-xs text-slate-600 dark:text-slate-300">
                {task.assignee ? task.assignee[0] : '?'}
              </div>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{task.assignee}</span>
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">預計完成日</p>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center"><Calendar size={14} className="mr-1.5 text-slate-400" />{task.due}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">文件產出規定</p>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{task.reqDoc ? '✅ 需產出並歸檔' : '無特別規定'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">總狀態</p>
            <div>{getStatusBadge(task.status)}</div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/80">
          <h3 className="font-semibold text-slate-800 dark:text-white">子任務拆解清單</h3>
          <button className="text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:underline flex items-center"><Plus size={16} className="mr-1"/> 新增子任務</button>
        </div>
        <table className="w-full text-left">
          <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500">子任務名稱</th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500">負責人</th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500">期限</th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500">狀態</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {task.subTasks && task.subTasks.length > 0 ? task.subTasks.map(sub => (
              <tr key={sub.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                <td className="py-3 px-6 text-sm font-medium text-slate-800 dark:text-slate-200">{sub.title}</td>
                <td className="py-3 px-6 text-sm text-slate-600 dark:text-slate-400">{sub.assignee}</td>
                <td className="py-3 px-6 text-sm text-slate-600 dark:text-slate-400">{sub.due}</td>
                <td className="py-3 px-6">{getStatusBadge(sub.status)}</td>
              </tr>
            )) : (
              <tr><td colSpan="4" className="py-4 px-6 text-sm text-slate-500 text-center">目前無子任務</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm p-6">
        <h3 className="font-semibold text-slate-800 dark:text-white mb-4 flex items-center">
          <FolderArchive size={18} className="mr-2 text-slate-400" /> 此工項之相關歸檔文件
        </h3>
        <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-8 flex flex-col items-center justify-center text-center">
          <FileText size={32} className="text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm text-slate-500">目前尚無關聯文件。在此拖曳上傳，系統將自動同步至 Google Drive。</p>
          <button className="mt-4 px-4 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-sm font-medium rounded-lg hover:shadow-sm transition-all">選擇檔案上傳</button>
        </div>
      </div>
    </div>
  );

  const currentSelectedTask = selectedTask ? displayTasks.find(t => t.uid === selectedTask.uid) : null;
  if (currentSelectedTask) return renderTaskDetail(currentSelectedTask);

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
          <button onClick={exportTasksToCSV} className="flex items-center space-x-2 px-4 py-2 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 text-sm font-medium transition-colors">
            <Download size={16} /><span>匯出 CSV (含現有工項)</span>
          </button>
          <button onClick={triggerFileInput} disabled={isImporting} className="flex items-center space-x-2 px-4 py-2 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/30 text-sm font-medium transition-colors">
            {isImporting ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            <span>匯入 CSV 更新</span>
          </button>
          <button onClick={handleAddTask} className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm text-sm font-medium transition-colors">
            <Plus size={16} /><span>新增任務</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 dark:bg-slate-800/80 sticky top-0 z-10">
            <tr>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700">主模組 (Epic)</th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700">任務名稱</th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700">負責人</th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700">目前執行節點</th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700 text-center">狀態</th>
              <th className="py-3 px-6 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700 text-right">詳情</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 bg-white dark:bg-slate-800">
            {displayTasks.length === 0 ? (
              <tr>
                <td colSpan="6" className="py-16 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <FolderArchive size={48} className="text-slate-300 dark:text-slate-600 mb-4" />
                    <p className="text-slate-700 dark:text-slate-300 font-medium mb-1">此專案目前尚無從 Firebase 讀取到的工項資料</p>
                    <p className="text-slate-500 text-sm mb-6 max-w-md">您可以手動點擊右上方「新增任務」，或先匯出空白的 CSV 範例檔填寫後進行批次匯入。</p>
                    <div className="flex space-x-4">
                      <button onClick={exportTasksToCSV} className="px-4 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-medium text-sm rounded-lg hover:shadow-sm flex items-center transition-all">
                        <Download size={16} className="mr-2" />匯出空白 CSV 範例
                      </button>
                      <button onClick={triggerFileInput} disabled={isImporting} className="px-4 py-2 bg-indigo-50 text-indigo-600 font-medium text-sm rounded-lg hover:bg-indigo-100 flex items-center transition-colors">
                        {isImporting ? <Loader2 size={16} className="animate-spin mr-2" /> : <FileSpreadsheet size={16} className="mr-2" />}
                        匯入 CSV 工項清單
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              displayTasks.map(task => (
                <tr key={task.id} onClick={() => setSelectedTask(task)} className="hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10 cursor-pointer group transition-colors">
                  <td className="py-4 px-6 text-sm text-slate-500 dark:text-slate-400">{task.epic}</td>
                  <td className="py-4 px-6 text-sm font-bold text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 transition-colors">
                    <div className="flex items-center">
                      {task.status === 'overdue' && <AlertCircle size={14} className="mr-1.5 text-red-500" />}
                      {task.title}
                    </div>
                  </td>
                  <td className="py-4 px-6 text-sm">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center text-xs text-slate-600">{task.assignee ? task.assignee[0] : '?'}</div>
                      <span className="text-slate-700 dark:text-slate-300">{task.assignee}</span>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-sm">
                    <span className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2.5 py-1 rounded-md">{task.currentProgress}</span>
                  </td>
                  <td className="py-4 px-6 text-center">{getStatusBadge(task.status)}</td>
                  <td className="py-4 px-6 text-right">
                    <button className="text-indigo-600 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity font-medium text-sm flex items-center justify-end w-full">
                      查看全貌 <ChevronRight size={16} className="ml-1" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
