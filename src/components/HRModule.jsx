import React, { useState, useEffect, useRef } from 'react';
import { Users, CheckCircle2, AlertCircle, Upload, Plus, Settings, X, Save, Trash2, PieChart, Edit2, FileText, Download, Loader2, File as FileIcon, CalendarDays, Mail, ArrowUpDown, ArrowUp, ArrowDown, Filter, ChevronRight, LineChart } from 'lucide-react';
import { collection, onSnapshot, doc, addDoc, deleteDoc, updateDoc, getFirestore } from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';

// 使用行內初始化避免編譯器路徑錯誤
const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

export default function HRModule({ user, selectedProject }) {
  const [personnel, setPersonnel] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [dbError, setDbError] = useState(null); 
  
  // 專案與子頁籤狀態
  const [projectData, setProjectData] = useState({});
  const [projectName, setProjectName] = useState(''); 
  const [activeSubTab, setActiveSubTab] = useState('hr'); // 'hr' | 'attendance'
  
  // Modals 控制狀態
  const [isAddPersonModalOpen, setIsAddPersonModalOpen] = useState(false);
  const [isReqModalOpen, setIsReqModalOpen] = useState(false);
  const [isVacancyModalOpen, setIsVacancyModalOpen] = useState(false); // 職位空缺明細 Modal
  const [isForecastModalOpen, setIsForecastModalOpen] = useState(false); // 未來預估明細 Modal
  
  // 維護與編輯人員 Modal 狀態
  const [editingPerson, setEditingPerson] = useState(null);

  // 檔案上傳相關狀態
  const reqFileInputRef = useRef(null);
  const personFileInputRef = useRef(null);
  const [isImportingReq, setIsImportingReq] = useState(false);
  const [isImportingPerson, setIsImportingPerson] = useState(false);
  const [uploadingPersonnelId, setUploadingPersonnelId] = useState(null);

  // 排序與過濾狀態
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [selectedUnitFilter, setSelectedUnitFilter] = useState('ALL');

  // 動態取得專案設定日期與精準本地今天日期
  const currentYear = new Date().getFullYear();
  const defaultStartDate = projectData.startDate || `${currentYear}-01-01`;
  const defaultEndDate = projectData.endDate || `${currentYear}-12-31`;
  
  const getLocalTodayStr = () => {
    const d = new Date();
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d - tzOffset).toISOString().split('T')[0];
  };
  const today = getLocalTodayStr();
  const todayMs = new Date(today).getTime();

  // 表單狀態
  const [newPerson, setNewPerson] = useState({
    name: '', email: '', role: '', unit: '', isResident: true, hireDate: '', roleStartDate: '', proxyAlert: false,
    contractStart: defaultStartDate, contractEnd: '', files: []
  });
  
  const [newReq, setNewReq] = useState({
    unit: '', position: '', startDate: defaultStartDate, endDate: defaultEndDate, count: 1, isResident: true, note: ''
  });

  const [transferData, setTransferData] = useState({
    unit: '', role: '', startDate: today
  });

  // 0. 動態取得專案名稱與區間設定
  useEffect(() => {
    if (!selectedProject) return;
    const projectRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'projects', selectedProject);
    const unsubscribe = onSnapshot(projectRef, (docSnap) => {
      if (docSnap.exists()) {
        setProjectData(docSnap.data());
        setProjectName(docSnap.data().name);
      }
    });
    return () => unsubscribe();
  }, [selectedProject]);

  // 1. 讀取人事資料與人力需求設定
  useEffect(() => {
    if (!user || !selectedProject) return;
    setDbError(null); 

    const hrRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'personnel');
    const reqRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'manpower_reqs');
    
    const unsubHR = onSnapshot(hrRef, (snapshot) => {
      const loadedData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const projectPersonnel = loadedData.filter(p => p.projectId === selectedProject);
      projectPersonnel.sort((a, b) => new Date(b.hireDate) - new Date(a.hireDate));
      setPersonnel(projectPersonnel);
    }, (error) => {
      console.error("Firestore人事資料讀取失敗:", error);
      if (error.code === 'permission-denied') setDbError('【權限不足】無法讀取人事資料，請確認 Firebase Rules 已正確發布！');
    });

    const unsubReq = onSnapshot(reqRef, (snapshot) => {
      const loadedReqs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const projectReqs = loadedReqs.filter(r => r.projectId === selectedProject);
      setRequirements(projectReqs);
    }, (error) => {
      console.error("Firestore需求資料讀取失敗:", error);
      if (error.code === 'permission-denied') setDbError('【權限不足】無法讀取人力需求，請確認 Firebase Rules 已正確發布！');
    });

    return () => { unsubHR(); unsubReq(); };
  }, [user, selectedProject]);

  // 動態判定在職狀態邏輯
  const getPersonStatus = (p) => {
    const startMs = new Date(p.contractStart || p.hireDate).getTime();
    const endMs = p.contractEnd ? new Date(p.contractEnd).getTime() : Infinity;

    if (startMs > todayMs) return 'pending';  // 尚未到職
    if (endMs < todayMs) return 'inactive';   // 已離職
    return 'active';                          // 在職
  };

  const checkIsActive = (contractEnd) => {
    if (!contractEnd) return true;
    return new Date(contractEnd).getTime() >= todayMs;
  };

  // 動態推導可用的單位與職位清單
  const availableUnits = [...new Set(requirements.map(r => r.unit))].filter(Boolean);
  const allExistingUnits = [...new Set([...availableUnits, ...personnel.map(p => p.unit)])].filter(Boolean);
  
  // 建立動態且高對比的單位色彩標籤
  const UNIT_COLORS = [
    'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-500/30',
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-500/30',
    'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-500/30',
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-500/30',
    'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-900/30 dark:text-pink-400 dark:border-pink-500/30',
    'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-400 dark:border-cyan-500/30',
    'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-500/30',
    'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-400 dark:border-teal-500/30'
  ];

  const getUnitColorClass = (unitName) => {
    if (!unitName) return 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
    const index = allExistingUnits.indexOf(unitName);
    if (index === -1) return 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
    return UNIT_COLORS[index % UNIT_COLORS.length];
  };

  const getPositionsForUnit = (unit) => [...new Set(requirements.filter(r => r.unit === unit).map(r => r.position))].filter(Boolean);
  const addAvailablePositions = getPositionsForUnit(newPerson.unit);
  const transferAvailablePositions = getPositionsForUnit(transferData.unit);

  // 處理排序與過濾邏輯
  const filteredPersonnel = personnel.filter(p => {
    if (selectedUnitFilter === 'ALL') return true;
    return p.unit === selectedUnitFilter;
  });

  const sortedPersonnel = [...filteredPersonnel].sort((a, b) => {
    if (!sortConfig.key) return 0;
    let aValue = '';
    let bValue = '';

    switch (sortConfig.key) {
      case 'name':
        aValue = a.name || '';
        bValue = b.name || '';
        break;
      case 'status':
        const order = { 'active': 1, 'pending': 2, 'inactive': 3 };
        aValue = `${order[getPersonStatus(a)]}-${a.isResident ? '1' : '0'}`;
        bValue = `${order[getPersonStatus(b)]}-${b.isResident ? '1' : '0'}`;
        break;
      case 'role':
        aValue = a.role || '';
        bValue = b.role || '';
        break;
      case 'roleDate':
        aValue = a.roleStartDate || a.hireDate || '';
        bValue = b.roleStartDate || b.hireDate || '';
        break;
      case 'date':
        aValue = a.contractStart || a.hireDate || ''; 
        bValue = b.contractStart || b.hireDate || '';
        break;
      default:
        break;
    }

    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown size={14} className="inline ml-1 text-slate-300 dark:text-slate-600" />;
    return sortConfig.direction === 'asc' ? <ArrowUp size={14} className="inline ml-1 text-indigo-500" /> : <ArrowDown size={14} className="inline ml-1 text-indigo-500" />;
  };

  // 匯出現況人員清冊 (CSV)
  const exportCurrentPersonnelCSV = () => {
    if (sortedPersonnel.length === 0) {
      alert('目前無人員資料可供匯出');
      return;
    }

    const headers = ['姓名', 'Email', '計畫單位', '目前職位', '駐點狀態', '在職狀態', '最初到職日', '就任此職位日', '計畫參與開始日', '計畫參與結束日'];
    const csvRows = [headers.join(',')];

    sortedPersonnel.forEach(p => {
      const status = getPersonStatus(p);
      let statusStr = '';
      if (status === 'active') statusStr = '在職';
      else if (status === 'inactive') statusStr = '已離職';
      else if (status === 'pending') statusStr = '尚未到職';

      const residentStr = p.isResident ? '是' : '否';

      const row = [
        `"${p.name || ''}"`,
        `"${p.email || ''}"`,
        `"${p.unit || ''}"`,
        `"${p.role || ''}"`,
        residentStr,
        statusStr,
        p.hireDate || '',
        p.roleStartDate || '',
        p.contractStart || '',
        p.contractEnd || '至今'
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = "\uFEFF" + csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `現況人員清冊_${projectName || selectedProject}_${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 打開 Modal 時套用最新預設日期
  const handleOpenAddPersonModal = () => {
    setNewPerson({ 
      name: '', email: '', role: '', unit: '', isResident: true, hireDate: '', roleStartDate: '', proxyAlert: false,
      contractStart: defaultStartDate, contractEnd: '', files: []
    });
    setIsAddPersonModalOpen(true);
  };

  const handleOpenReqModal = () => {
    setNewReq({ unit: '', position: '', startDate: defaultStartDate, endDate: defaultEndDate, count: 1, isResident: true, note: '' });
    setIsReqModalOpen(true);
  };

  const handleOpenEditPerson = (person) => {
    setEditingPerson(JSON.parse(JSON.stringify(person)));
  };

  // 輔助函式：處理 Excel 匯入的日期格式自動補零與符號轉換
  const formatImportDate = (dateStr) => {
    if (!dateStr || dateStr.trim() === '') return '';
    let s = dateStr.trim().replace(/\//g, '-');
    const parts = s.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    return s;
  };

  // 2. 處理單筆新增人員
  const handleAddPerson = async (e) => {
    e.preventDefault();
    if (!newPerson.name || !newPerson.role || !newPerson.unit || !newPerson.hireDate) {
      alert('請填寫必填欄位 (姓名、計畫單位、職務、到職日)');
      return;
    }
    
    try {
      const hrRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'personnel');
      const initialHistory = [{
        unit: newPerson.unit,
        role: newPerson.role,
        startDate: newPerson.roleStartDate || newPerson.hireDate,
        endDate: ''
      }];

      await addDoc(hrRef, {
        ...newPerson,
        roleStartDate: newPerson.roleStartDate || newPerson.hireDate,
        history: initialHistory,
        projectId: selectedProject,
        createdAt: new Date().getTime()
      });
      setIsAddPersonModalOpen(false);
    } catch (error) {
      console.error("新增人員失敗:", error);
      if (error.code === 'permission-denied') alert('【權限不足】寫入被 Firebase 拒絕並還原。請至 Firebase 控制台更新 Rules！');
    }
  };

  const exportPersonCSVTemplate = () => {
    const csvContent = `\uFEFF姓名,Email,計畫單位,目前職位,最初到職日(YYYY-MM-DD),就任此職位日(YYYY-MM-DD),計畫參與開始日(YYYY-MM-DD),計畫參與結束日(留空或YYYY-MM-DD)\n王大明,wang@example.com,專案辦公室,專員,${defaultStartDate},${defaultStartDate},${defaultStartDate},`;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "計畫人員建檔_匯入範例.csv";
    link.click();
  };

  const handlePersonFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !user || !selectedProject) return;

    setIsImportingPerson(true);
    try {
      const text = await file.text();
      const rows = text.split('\n').filter(row => row.trim().length > 0);
      const isHeader = rows[0].includes('姓名') || rows[0].includes('單位');
      const startIndex = isHeader ? 1 : 0;
      const hrRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'personnel');

      let importCount = 0;
      for (let i = startIndex; i < rows.length; i++) {
        const cols = rows[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        if (cols.length >= 4) {
          const name = cols[0];
          const email = cols[1];
          const unit = cols[2];
          const role = cols[3];
          
          const hireDate = formatImportDate(cols[4]) || defaultStartDate;
          const roleStartDate = formatImportDate(cols[5]) || hireDate;
          const contractStart = formatImportDate(cols[6]) || defaultStartDate;
          const contractEnd = formatImportDate(cols[7]);

          if (!name || !role || !unit) continue;

          const matchedReq = requirements.find(r => r.unit === unit && r.position === role);
          const isResident = matchedReq ? matchedReq.isResident : false;

          const initialHistory = [{
            unit: unit, role: role, startDate: roleStartDate, endDate: ''
          }];

          await addDoc(hrRef, {
            name, email, unit, role, isResident, hireDate, roleStartDate, contractStart, contractEnd,
            status: 'active', proxyAlert: false, files: [], history: initialHistory,
            projectId: selectedProject, createdAt: new Date().getTime()
          });
          importCount++;
        }
      }
      alert(`✅ 成功匯入 ${importCount} 筆人員資料`);
      setIsAddPersonModalOpen(false);
    } catch (error) {
      console.error("人員 CSV 匯入失敗:", error);
      alert('CSV 匯入失敗，請確認檔案格式與欄位順序是否正確。');
    } finally {
      setIsImportingPerson(false);
      e.target.value = ''; 
    }
  };

  const handleAddReq = async (e) => {
    e.preventDefault();
    if (!newReq.unit || !newReq.position || !newReq.startDate || !newReq.endDate) {
      alert('請填寫所有需求必填欄位');
      return;
    }

    try {
      const reqRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'manpower_reqs');
      await addDoc(reqRef, {
        ...newReq,
        count: parseInt(newReq.count, 10) || 1,
        isResident: String(newReq.isResident) === 'true',
        projectId: selectedProject,
        createdAt: new Date().getTime()
      });
      setNewReq({ unit: '', position: '', startDate: defaultStartDate, endDate: defaultEndDate, count: 1, isResident: true, note: '' });
    } catch (error) {
      console.error("新增人力需求失敗:", error);
      if (error.code === 'permission-denied') alert('【權限不足】寫入被 Firebase 拒絕並還原。');
    }
  };

  const handleDeleteReq = async (reqId) => {
    try {
      await deleteDoc(doc(db, 'artifacts', globalAppId, 'public', 'data', 'manpower_reqs', reqId));
    } catch (error) {
      console.error("刪除需求失敗:", error);
    }
  };

  const exportReqCSVTemplate = () => {
    const csvContent = `\uFEFF單位,職位,需求人數,需求開始日(YYYY-MM-DD),需求結束日(YYYY-MM-DD),是否駐點(是/否),額外需求說明\n範例單位,專員,2,${defaultStartDate},${defaultEndDate},是,需具備相關證照`;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "人力需求設定_匯入範例.csv";
    link.click();
  };

  const handleReqFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !user || !selectedProject) return;

    setIsImportingReq(true);
    try {
      const text = await file.text();
      const rows = text.split('\n').filter(row => row.trim().length > 0);
      const isHeader = rows[0].includes('單位') || rows[0].includes('職位');
      const startIndex = isHeader ? 1 : 0;
      const reqRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'manpower_reqs');

      let importCount = 0;
      for (let i = startIndex; i < rows.length; i++) {
        const cols = rows[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        if (cols.length >= 2) {
          await addDoc(reqRef, {
            unit: cols[0], position: cols[1], count: parseInt(cols[2], 10) || 1,
            startDate: formatImportDate(cols[3]) || defaultStartDate, 
            endDate: formatImportDate(cols[4]) || defaultEndDate,
            isResident: cols[5] === '是' || cols[5] === 'true', note: cols[6] || '',
            projectId: selectedProject, createdAt: new Date().getTime()
          });
          importCount++;
        }
      }
      alert(`✅ 成功匯入 ${importCount} 筆人力需求設定`);
    } catch (error) {
      console.error("CSV 匯入失敗:", error);
      alert('CSV 匯入失敗，請確認檔案格式是否正確。');
    } finally {
      setIsImportingReq(false);
      e.target.value = ''; 
    }
  };

  const handleSaveEditPerson = async (e) => {
    e.preventDefault();
    if (!editingPerson.name || !editingPerson.hireDate) {
      alert("請填寫必填欄位：姓名與最初到職日");
      return;
    }

    const validHistory = (editingPerson.history || []).filter(h => h.unit && h.role && h.startDate);
    if (validHistory.length === 0) {
      alert("請至少保留一筆完整的職務歷程紀錄 (需含單位、職務與開始日期)。");
      return;
    }

    const sortedHistory = [...validHistory].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

    for (let i = 0; i < sortedHistory.length; i++) {
      const current = sortedHistory[i];
      const next = sortedHistory[i + 1];

      if (current.endDate && new Date(current.startDate).getTime() > new Date(current.endDate).getTime()) {
        alert(`歷程日期錯誤：【${current.role}】的開始日不能晚於結束日！`);
        return;
      }

      if (next) {
        if (!current.endDate) {
          alert(`歷程日期錯誤：因後續有轉任【${next.role}】，先前的職務【${current.role}】必須填寫結束日！`);
          return;
        }
        // 嚴格阻擋重疊：結束日必須確實早於下一個開始日
        if (new Date(current.endDate).getTime() >= new Date(next.startDate).getTime()) {
          alert(`歷程重疊錯誤：【${current.role}】的結束日 (${current.endDate}) 必須早於【${next.role}】的開始日 (${next.startDate})！\n\n同一個人不可在同一天身兼兩筆歷程。`);
          return;
        }
      }
    }

    const latestRecord = sortedHistory[sortedHistory.length - 1];

    const matchedReq = requirements.find(r => r.unit === latestRecord.unit && r.position === latestRecord.role);
    const newIsResident = matchedReq ? matchedReq.isResident : false;

    try {
      const personRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'personnel', editingPerson.id);
      await updateDoc(personRef, {
        name: editingPerson.name,
        email: editingPerson.email || '',
        hireDate: editingPerson.hireDate,
        contractStart: editingPerson.contractStart || '',
        contractEnd: editingPerson.contractEnd || '',
        history: sortedHistory,
        unit: latestRecord.unit,
        role: latestRecord.role,
        roleStartDate: latestRecord.startDate,
        isResident: newIsResident
      });
      setEditingPerson(null);
    } catch (error) {
      console.error("更新人員失敗:", error);
      if (error.code === 'permission-denied') alert('【權限不足】操作被 Firebase 拒絕並還原。');
    }
  };

  const handlePersonnelFileUpload = async (e, personId) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPersonnelId(personId);
    setTimeout(async () => {
      try {
        const person = personnel.find(p => p.id === personId);
        const currentFiles = person.files || [];
        const newFile = { id: Date.now(), name: file.name, uploadDate: new Date().toISOString().split('T')[0], url: '#' };
        const personRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'personnel', personId);
        await updateDoc(personRef, { files: [...currentFiles, newFile] });

        if (editingPerson && editingPerson.id === personId) {
          setEditingPerson(prev => ({ ...prev, files: [...currentFiles, newFile] }));
        }
      } catch (error) {
        console.error("檔案上傳失敗:", error);
      } finally {
        setUploadingPersonnelId(null);
        e.target.value = '';
      }
    }, 1200);
  };

  // =========================================================================
  // 核心邏輯升級：【聚合式】防呆與強制正規化的空缺推演引擎
  // =========================================================================
  
  // 將人力需求依照 Unit + Role 聚合，避免多筆設定互相干擾導致漏抓空窗
  const reqGroups = {};
  requirements.forEach(req => {
    const key = `${req.unit}::${req.position}`;
    if (!reqGroups[key]) reqGroups[key] = { unit: req.unit, role: req.position, reqs: [] };
    
    const rCount = parseInt(req.count, 10) || 1;
    const sMs = req.startDate ? new Date(req.startDate).getTime() : 0;
    const eMs = req.endDate ? new Date(req.endDate).getTime() : Infinity;
    
    reqGroups[key].reqs.push({ count: rCount, sMs, eMs, originalReq: req });
  });

  // -- 1. 計算過去到今天的空缺 (現有異常) --
  let totalVacancyDays = 0;
  const vacancyBreakdown = []; 

  Object.values(reqGroups).forEach(group => {
    const { unit, role, reqs } = group;
    let minStartMs = Math.min(...reqs.map(r => r.sMs));
    let maxEndMs = todayMs;

    if (minStartMs > maxEndMs) return;

    const segments = [];
    const personnelInRoleMap = new Map();

    personnel.forEach(p => {
      const personContractEndMs = p.contractEnd ? new Date(p.contractEnd).getTime() : todayMs;
      (p.history || []).forEach(h => {
        if (h.unit === unit && h.role === role) {
          const sMs = h.startDate ? new Date(h.startDate).getTime() : 0;
          let eMs = h.endDate ? new Date(h.endDate).getTime() : todayMs;
          eMs = Math.min(eMs, personContractEndMs); 
          
          if (sMs <= eMs) {
            if (sMs <= maxEndMs && eMs >= minStartMs) {
              const actualStartMs = Math.max(sMs, minStartMs);
              const actualEndMs = Math.min(eMs, maxEndMs);
              
              if (!personnelInRoleMap.has(p.id)) {
                personnelInRoleMap.set(p.id, { name: p.name, periods: [] });
              }
              personnelInRoleMap.get(p.id).periods.push({
                start: new Date(actualStartMs).toISOString().split('T')[0],
                end: actualEndMs === todayMs ? '至今' : new Date(actualEndMs).toISOString().split('T')[0]
              });
              segments.push({ sMs, eMs });
            }
          }
        }
      });
    });

    let reqVacancyDays = 0;
    let currentVacancyPeriod = null;
    const vacancyPeriods = [];
    let maxReqCount = 0;

    for (let time = minStartMs; time <= maxEndMs; time += 86400000) {
      let requiredCountToday = 0;
      reqs.forEach(r => { if (time >= r.sMs && time <= r.eMs) requiredCountToday += r.count; });
      maxReqCount = Math.max(maxReqCount, requiredCountToday);

      if (requiredCountToday === 0) {
        if (currentVacancyPeriod) {
            vacancyPeriods.push(currentVacancyPeriod);
            currentVacancyPeriod = null;
        }
        continue;
      }

      let activeCount = 0;
      segments.forEach(seg => { if (time >= seg.sMs && time <= seg.eMs) activeCount++; });
      
      const missingCount = requiredCountToday - activeCount;
      if (missingCount > 0) {
        reqVacancyDays += missingCount; 

        const currentDateStr = new Date(time).toISOString().split('T')[0];
        
        if (!currentVacancyPeriod) {
          currentVacancyPeriod = { startDate: currentDateStr, endDate: currentDateStr, missingCount, days: 1 };
        } else if (currentVacancyPeriod.missingCount === missingCount) {
          currentVacancyPeriod.endDate = currentDateStr; 
          currentVacancyPeriod.days += 1;
        } else {
          vacancyPeriods.push(currentVacancyPeriod);
          currentVacancyPeriod = { startDate: currentDateStr, endDate: currentDateStr, missingCount, days: 1 };
        }
      } else {
        if (currentVacancyPeriod) {
          vacancyPeriods.push(currentVacancyPeriod);
          currentVacancyPeriod = null;
        }
      }
    }
    if (currentVacancyPeriod) vacancyPeriods.push(currentVacancyPeriod);

    totalVacancyDays += reqVacancyDays;

    if (reqVacancyDays > 0) {
      vacancyBreakdown.push({
        unit: unit, position: role, requiredCount: maxReqCount,
        totalVacancyDays: reqVacancyDays, 
        reqStartDate: new Date(minStartMs).toISOString().split('T')[0], 
        reqEndDate: new Date(maxEndMs).toISOString().split('T')[0],
        personnelInRole: Array.from(personnelInRoleMap.values()), vacancyPeriods: vacancyPeriods
      });
    }
  });

  // -- 2. 未來異動與空缺預測引擎 (未來 60 天內) --
  const forecastDays = 60;
  const futureStartMs = todayMs + 86400000; // 從明天開始算
  const futureEndMs = todayMs + (forecastDays * 86400000);
  
  const upcomingEvents = []; 
  const futureVacancies = []; 

  // 2-1. 收集未來的人員異動與需求異動
  personnel.forEach(p => {
    // 尚未到職 (Onboard)
    const pStartMs = new Date(p.contractStart || p.hireDate).getTime();
    if (pStartMs >= futureStartMs && pStartMs <= futureEndMs) {
      const firstHistory = p.history?.[0];
      upcomingEvents.push({
        date: p.contractStart || p.hireDate,
        dateMs: pStartMs,
        type: 'onboard',
        unit: firstHistory?.unit,
        role: firstHistory?.role,
        personId: p.id,
        personName: p.name,
        desc: `${p.name} 預計新進到職 (${firstHistory?.unit || ''} - ${firstHistory?.role || ''})`
      });
    }

    // 未來離職
    if (p.contractEnd) {
      const endMs = new Date(p.contractEnd).getTime();
      if (endMs >= futureStartMs && endMs <= futureEndMs) {
        const lastHistory = p.history?.[p.history.length - 1];
        if (lastHistory) {
          upcomingEvents.push({
            date: p.contractEnd,
            dateMs: endMs,
            type: 'leave',
            unit: lastHistory.unit,
            role: lastHistory.role,
            personId: p.id,
            personName: p.name,
            desc: `${p.name} 預計離職退出計畫 (${lastHistory.unit} - ${lastHistory.role})`
          });
        }
      }
    }

    // 未來內部轉任
    (p.history || []).forEach((h, i) => {
      // 轉任出
      if (h.endDate && h.endDate !== p.contractEnd) {
        const hEndMs = new Date(h.endDate).getTime();
        if (hEndMs >= futureStartMs && hEndMs <= futureEndMs) {
          upcomingEvents.push({
            date: h.endDate, dateMs: hEndMs,
            type: 'transfer_out', unit: h.unit, role: h.role, personId: p.id, personName: p.name,
            desc: `${p.name} 預計卸任原職務 (${h.unit} - ${h.role})`
          });
        }
      }
      // 轉任入
      if (i > 0) {
        const hStartMs = new Date(h.startDate).getTime();
        if (hStartMs >= futureStartMs && hStartMs <= futureEndMs) {
          upcomingEvents.push({
            date: h.startDate, dateMs: hStartMs,
            type: 'transfer_in', unit: h.unit, role: h.role, personId: p.id, personName: p.name,
            desc: `${p.name} 預計轉任接手 (${h.unit} - ${h.role})`
          });
        }
      }
    });
  });

  // 新增人力需求
  requirements.forEach(r => {
    const rStartMs = r.startDate ? new Date(r.startDate).getTime() : 0;
    const rCount = parseInt(r.count, 10) || 1;
    if (rStartMs >= futureStartMs && rStartMs <= futureEndMs) {
      upcomingEvents.push({
        date: r.startDate, dateMs: rStartMs,
        type: 'new_req', unit: r.unit, role: r.position, count: rCount,
        desc: `計畫新增人力編制需求 (${r.unit} - ${r.position}，擴編 ${rCount} 人)`
      });
    }
  });

  upcomingEvents.sort((a, b) => a.dateMs - b.dateMs);

  // 【核心緊縮：嚴格補位偵測】
  upcomingEvents.forEach(evt => {
    if (['leave', 'transfer_out', 'new_req'].includes(evt.type)) {
      const gapDateMs = evt.dateMs;
      const replacements = personnel.filter(p => {
        if (p.id === evt.personId) return false; 
        return (p.history || []).some(h => {
           if (h.unit === evt.unit && h.role === evt.role) {
              const hStartMs = new Date(h.startDate).getTime();
              const diffDays = (hStartMs - gapDateMs) / 86400000;
              // 嚴格對齊：新職務開始日必須在空缺發生的前 3 天到後 7 天內，才算具備專屬補位意圖
              return diffDays >= -3 && diffDays <= 7; 
           }
           return false;
        });
      });
      if (replacements.length > 0) {
        evt.replacements = replacements;
      }
    }
  });

  // 2-2. 模擬未來 60 天的空缺推演 (使用聚合引擎)
  Object.values(reqGroups).forEach(group => {
    const { unit, role, reqs } = group;
    const checkStartMs = futureStartMs;
    const checkEndMs = futureEndMs;

    const segments = [];
    personnel.forEach(p => {
      const personContractEndMs = p.contractEnd ? new Date(p.contractEnd).getTime() : checkEndMs + 86400000;
      (p.history || []).forEach(h => {
        if (h.unit === unit && h.role === role) {
          const sMs = h.startDate ? new Date(h.startDate).getTime() : 0;
          let eMs = h.endDate ? new Date(h.endDate).getTime() : checkEndMs + 86400000;
          eMs = Math.min(eMs, personContractEndMs);
          if (sMs <= eMs && sMs <= checkEndMs && eMs >= checkStartMs) {
            segments.push({ sMs, eMs });
          }
        }
      });
    });

    let currentFutureVacancy = null;
    for (let time = checkStartMs; time <= checkEndMs; time += 86400000) {
      let requiredCountToday = 0;
      reqs.forEach(r => { if (time >= r.sMs && time <= r.eMs) requiredCountToday += r.count; });

      if (requiredCountToday === 0) {
        if (currentFutureVacancy) {
            futureVacancies.push({...currentFutureVacancy, unit, role});
            currentFutureVacancy = null;
        }
        continue;
      }

      let activeCount = 0;
      segments.forEach(seg => { if (time >= seg.sMs && time <= seg.eMs) activeCount++; });
      
      const missingCount = requiredCountToday - activeCount;
      if (missingCount > 0) {
        const currentDateStr = new Date(time).toISOString().split('T')[0];
        if (!currentFutureVacancy) {
          currentFutureVacancy = { startDate: currentDateStr, endDate: currentDateStr, missingCount };
        } else if (currentFutureVacancy.missingCount === missingCount) {
          currentFutureVacancy.endDate = currentDateStr;
        } else {
          futureVacancies.push({...currentFutureVacancy, unit, role});
          currentFutureVacancy = { startDate: currentDateStr, endDate: currentDateStr, missingCount };
        }
      } else {
        if (currentFutureVacancy) {
          futureVacancies.push({...currentFutureVacancy, unit, role});
          currentFutureVacancy = null;
        }
      }
    }
    if (currentFutureVacancy) {
      futureVacancies.push({...currentFutureVacancy, unit, role});
    }
  });

  const unitSummary = personnel.reduce((acc, curr) => {
    if (getPersonStatus(curr) === 'active') {
      const unitName = curr.unit || '未指定單位';
      acc[unitName] = (acc[unitName] || 0) + 1;
    }
    return acc;
  }, {});
  const totalActivePersonnel = Object.values(unitSummary).reduce((a, b) => a + b, 0);

  // 上方卡片數據準備 (動態計算聚合結果)
  let activeReqsSum = 0;
  let activeReqsNonResSum = 0;
  Object.values(reqGroups).forEach(group => {
    let dayCountRes = 0;
    let dayCountNonRes = 0;
    group.reqs.forEach(r => {
      if (todayMs >= r.sMs && todayMs <= r.eMs) {
        if (r.originalReq.isResident) dayCountRes += r.count;
        else dayCountNonRes += r.count;
      }
    });
    activeReqsSum += dayCountRes;
    activeReqsNonResSum += dayCountNonRes;
  });

  const residentCount = personnel.filter(p => p.isResident && getPersonStatus(p) === 'active').length;
  const nonResidentCount = personnel.filter(p => !p.isResident && getPersonStatus(p) === 'active').length;

  const isResidentCompliant = activeReqsSum > 0 ? residentCount >= activeReqsSum : true;
  const isNonResidentCompliant = activeReqsNonResSum > 0 ? nonResidentCount >= activeReqsNonResSum : true;

  const proxyAlertCount = personnel.filter(p => p.proxyAlert && getPersonStatus(p) === 'active').length;

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-6xl mx-auto">
      
      {dbError && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-4 rounded-2xl flex items-start animate-in slide-in-from-top-2">
          <AlertCircle className="text-red-500 mr-3 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <h4 className="text-sm font-bold text-red-700 dark:text-red-400">Firebase 權限異常，您的變更已被還原</h4>
            <p className="text-xs text-red-600 dark:text-red-300 mt-1">{dbError}</p>
          </div>
        </div>
      )}

      {/* 標題與頁籤 */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-2">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">人事合規紀錄 ({projectName || '載入中...'})</h2>
          <p className="text-sm text-slate-500 mt-1">管理本計畫之人員名冊、動態歷程與人力需求合規狀態。</p>
        </div>
      </div>

      <div className="flex space-x-6 border-b border-slate-200 dark:border-slate-700 mb-6">
        <button
          onClick={() => setActiveSubTab('hr')}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors ${activeSubTab === 'hr' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          人事建檔與編制
        </button>
        <button
          onClick={() => setActiveSubTab('attendance')}
          className={`pb-3 text-sm font-bold border-b-2 transition-colors ${activeSubTab === 'attendance' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          考勤紀錄與規政代理
        </button>
      </div>

      {/* ================= 子頁籤 1: 人事建檔與編制 ================= */}
      {activeSubTab === 'hr' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          
          <div className="flex justify-end">
            <button 
              onClick={handleOpenReqModal}
              className="flex items-center space-x-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-sm font-bold border border-slate-200 dark:border-slate-700 shadow-sm"
            >
              <Settings size={16} className="text-indigo-500" />
              <span>設定計畫人力需求</span>
            </button>
          </div>

          {/* 上方統計區塊 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex items-center space-x-5 transition-colors">
              <div className="p-3.5 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400">
                <CheckCircle2 size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">目前駐點人力</p>
                <p className="text-2xl font-black text-slate-800 dark:text-white flex items-baseline">
                  {residentCount}
                  <span className="text-sm text-slate-400 mx-1">/ {activeReqsSum || 0}</span>
                </p>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm flex items-center space-x-5 transition-colors">
              <div className="p-3.5 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl text-emerald-600 dark:text-emerald-400">
                <Users size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">目前非駐點人力</p>
                <p className="text-2xl font-black text-slate-800 dark:text-white flex items-baseline">
                  {nonResidentCount}
                  <span className="text-sm text-slate-400 mx-1">/ {activeReqsNonResSum || 0}</span>
                </p>
              </div>
            </div>

            <div 
              onClick={() => totalVacancyDays > 0 && setIsVacancyModalOpen(true)}
              className={`p-6 rounded-2xl border shadow-sm flex items-center justify-between transition-colors ${totalVacancyDays > 0 ? 'bg-white dark:bg-slate-800 border-orange-200 dark:border-orange-500/30 cursor-pointer hover:border-orange-400 dark:hover:border-orange-500/50 group' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700/50'}`}
            >
              <div className="flex items-center space-x-5">
                <div className={`p-3.5 rounded-xl transition-transform ${totalVacancyDays > 0 ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 group-hover:scale-110' : 'bg-slate-50 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500'}`}>
                  <CalendarDays size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">異常空缺現況</p>
                  <p className={`text-2xl font-black ${totalVacancyDays > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-800 dark:text-white'}`}>
                    {totalVacancyDays} <span className={`text-sm font-medium ${totalVacancyDays > 0 ? 'text-orange-500' : 'text-slate-500'}`}>人天</span>
                  </p>
                </div>
              </div>
              {totalVacancyDays > 0 && (
                <div className="text-orange-500 dark:text-orange-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ChevronRight size={16} />
                </div>
              )}
            </div>

            {/* 近期異動預估卡片 */}
            <div 
              onClick={() => setIsForecastModalOpen(true)}
              className="p-6 rounded-2xl border shadow-sm flex items-center justify-between transition-colors bg-white dark:bg-slate-800 border-indigo-200 dark:border-indigo-500/30 cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500/50 group"
            >
              <div className="flex items-center space-x-5">
                <div className="p-3.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                  <LineChart size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">近期異動預估</p>
                  <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
                    {upcomingEvents.length} <span className="text-sm font-medium text-indigo-500">項變動</span>
                  </p>
                </div>
              </div>
              <div className="text-indigo-500 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronRight size={16} />
              </div>
            </div>

          </div>

          {/* 將各單位人數彙整區塊移動到這裡 */}
          {personnel.length > 0 && (
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm transition-colors">
              <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200 mb-4 flex items-center">
                <PieChart size={16} className="mr-2 text-indigo-500" />
                計畫單位人數彙整 (僅計在職)
              </h4>
              <div className="flex flex-wrap gap-4">
                {Object.entries(unitSummary).map(([unit, count]) => (
                  <div key={unit} className="px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between min-w-[160px]">
                    <span className="text-sm font-bold text-slate-600 dark:text-slate-300 mr-4">{unit}</span>
                    <span className="text-xl font-black text-indigo-600 dark:text-indigo-400">{count} <span className="text-xs font-medium text-slate-400">人</span></span>
                  </div>
                ))}
                <div className="px-4 py-3 bg-indigo-50 dark:bg-indigo-500/20 border border-indigo-200 dark:border-indigo-500/30 rounded-xl shadow-sm flex items-center justify-between min-w-[160px]">
                  <span className="text-sm font-bold text-indigo-800 dark:text-indigo-300 mr-4">總計在職人數</span>
                  <span className="text-xl font-black text-indigo-600 dark:text-indigo-400">{totalActivePersonnel} <span className="text-xs font-medium text-indigo-400 dark:text-indigo-500">人</span></span>
                </div>
              </div>
            </div>
          )}

          {/* 人員名冊表格與動態歷程 */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-200 dark:border-slate-700/50 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 dark:bg-slate-800/80 gap-4">
              <h3 className="font-bold text-slate-800 dark:text-white">人員名冊與動態歷程</h3>
              <div className="flex space-x-3">
                <button 
                  onClick={exportCurrentPersonnelCSV}
                  className="flex items-center space-x-2 px-4 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl hover:shadow-sm transition-all text-sm font-bold"
                >
                  <Download size={16} className="text-indigo-500 dark:text-indigo-400" />
                  <span>匯出現況人員清冊</span>
                </button>
                <button 
                  onClick={handleOpenAddPersonModal}
                  className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 shadow-sm font-bold text-sm transition-colors"
                >
                  <Plus size={16} />
                  <span>新增人員</span>
                </button>
              </div>
            </div>
            
            {/* 單位過濾區塊 */}
            {allExistingUnits.length > 0 && (
              <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800 flex flex-wrap gap-2 items-center">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 mr-2 flex items-center">
                  <Filter size={14} className="mr-1" /> 單位過濾：
                </span>
                <button 
                  onClick={() => setSelectedUnitFilter('ALL')}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${selectedUnitFilter === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'}`}
                >
                  全部 (ALL)
                </button>
                {allExistingUnits.map(unit => (
                  <button 
                    key={unit}
                    onClick={() => setSelectedUnitFilter(unit)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${selectedUnitFilter === unit ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'}`}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            )}
            
            <div className="overflow-x-auto flex-1 min-h-[450px]">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th 
                      className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors select-none"
                      onClick={() => handleSort('name')}
                    >
                      姓名/單位 <SortIcon columnKey="name" />
                    </th>
                    <th 
                      className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors select-none"
                      onClick={() => handleSort('status')}
                    >
                      狀態/駐點 <SortIcon columnKey="status" />
                    </th>
                    <th 
                      className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors select-none"
                      onClick={() => handleSort('role')}
                    >
                      現任職務 <SortIcon columnKey="role" />
                    </th>
                    <th 
                      className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors select-none"
                      onClick={() => handleSort('roleDate')}
                    >
                      就任日期 <SortIcon columnKey="roleDate" />
                    </th>
                    <th 
                      className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors select-none"
                      onClick={() => handleSort('date')}
                    >
                      參與計畫期間/到職日 <SortIcon columnKey="date" />
                    </th>
                    <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">相關檔案</th>
                    <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {personnel.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="py-16 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <Users size={48} className="text-slate-300 dark:text-slate-600 mb-4" />
                          <p className="text-slate-700 dark:text-slate-300 font-medium mb-1">此專案目前尚無人事建檔資料</p>
                          <p className="text-slate-500 text-sm">請點擊右上方「新增人員」建立計畫專屬人力。</p>
                        </div>
                      </td>
                    </tr>
                  ) : sortedPersonnel.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="py-16 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <Users size={48} className="text-slate-300 dark:text-slate-600 mb-4" />
                          <p className="text-slate-700 dark:text-slate-300 font-medium mb-1">查無符合目前條件之人員資料</p>
                          <p className="text-slate-500 text-sm">請嘗試切換上方的「單位過濾」條件。</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    sortedPersonnel.map(u => {
                      const status = getPersonStatus(u);
                      return (
                        <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors group">
                          <td className="py-4 px-6">
                            <div className="flex flex-col items-start">
                              <span className="font-bold text-slate-900 dark:text-slate-200">{u.name}</span>
                              <span className="text-[10px] text-slate-400 mb-1">{u.email || '未建立 Email'}</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border w-fit mt-0.5 ${getUnitColorClass(u.unit)}`}>
                                {u.unit || '未指定單位'}
                              </span>
                            </div>
                          </td>
                          <td className="py-4 px-6">
                            <div className="flex flex-col items-start gap-1">
                              {status === 'active' && <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 rounded text-[10px] font-bold border border-emerald-200 dark:border-emerald-500/30">在職</span>}
                              {status === 'inactive' && <span className="px-2 py-0.5 bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400 rounded text-[10px] font-bold border border-slate-200 dark:border-slate-600">已離職</span>}
                              {status === 'pending' && <span className="px-2 py-0.5 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 rounded text-[10px] font-bold border border-blue-200 dark:border-blue-500/30">尚未到職</span>}
                              {u.isResident ? <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">駐點人員</span> : <span className="text-[10px] text-slate-400">非駐點</span>}
                            </div>
                          </td>
                          <td className="py-4 px-6">
                            <span className="font-bold text-slate-700 dark:text-slate-300 text-sm">{u.role}</span>
                          </td>
                          <td className="py-4 px-6">
                            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{u.roleStartDate || u.hireDate}</span>
                          </td>
                          <td className="py-4 px-6">
                            <div className="text-sm font-bold text-indigo-700 dark:text-indigo-400 font-mono tracking-tight">
                              {u.contractStart || '-'} ~ {u.contractEnd || '至今'}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-1">
                              最初到職日: {u.hireDate}
                            </div>
                          </td>
                          <td className="py-4 px-6">
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                {u.files?.length || 0} 個檔案
                              </span>
                              <label className="cursor-pointer p-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-500/20 dark:text-indigo-400 dark:hover:bg-indigo-500/40 rounded-lg transition-colors" title="上傳相關檔案 (例如: 畢業證書)">
                                <input 
                                  type="file" 
                                  className="hidden" 
                                  onChange={(e) => handlePersonnelFileUpload(e, u.id)} 
                                  disabled={uploadingPersonnelId === u.id}
                                />
                                {uploadingPersonnelId === u.id ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                              </label>
                            </div>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <button 
                              onClick={() => handleOpenEditPerson(u)}
                              className="text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg dark:text-indigo-400 dark:hover:bg-indigo-500/20 text-xs font-bold transition-colors opacity-0 group-hover:opacity-100 flex items-center justify-end w-full"
                            >
                              <Edit2 size={14} className="mr-1.5" /> 維護與檢視
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= 子頁籤 2: 考勤與規政代理 ================= */}
      {activeSubTab === 'attendance' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className={`bg-white dark:bg-slate-800 p-6 rounded-2xl border shadow-sm flex items-center space-x-5 transition-colors ${proxyAlertCount > 0 ? 'border-orange-200 dark:border-orange-500/30' : 'border-slate-200 dark:border-slate-700/50'}`}>
              <div className={`p-3.5 rounded-xl ${proxyAlertCount > 0 ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400' : 'bg-slate-50 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500'}`}>
                <AlertCircle size={28} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-1">規政代理異常待補件</p>
                <p className={`text-3xl font-black ${proxyAlertCount > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-800 dark:text-white'}`}>
                  {proxyAlertCount} <span className={`text-sm font-medium ${proxyAlertCount > 0 ? 'text-orange-500' : 'text-slate-500'}`}>件</span>
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-slate-800 dark:text-white mb-1">匯入出勤紀錄</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">上傳每月考勤 Excel 報表，系統將自動比對請假天數與規政代理合規性。</p>
            </div>
            <button className="flex items-center justify-center space-x-2 px-5 py-2.5 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors text-sm font-bold flex-shrink-0">
              <Upload size={18} />
              <span>匯入考勤 Excel</span>
            </button>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-200 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/80">
              <h3 className="font-bold text-slate-800 dark:text-white">規政代理異常名單</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">人員姓名</th>
                    <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">所屬單位</th>
                    <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">異常狀態</th>
                    <th className="py-4 px-6 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {personnel.filter(p => p.proxyAlert && getPersonStatus(p) === 'active').length === 0 ? (
                     <tr>
                       <td colSpan="4" className="py-12 text-center text-slate-500 dark:text-slate-400 text-sm font-medium">目前無任何代理異常紀錄。</td>
                     </tr>
                  ) : (
                    personnel.filter(p => p.proxyAlert && getPersonStatus(p) === 'active').map(u => (
                      <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                        <td className="py-4 px-6 font-bold text-slate-900 dark:text-slate-200">{u.name}</td>
                        <td className="py-4 px-6 text-sm text-slate-600 dark:text-slate-400">{u.unit}</td>
                        <td className="py-4 px-6">
                          <span className="inline-flex items-center px-2 py-1 rounded bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 text-xs font-bold border border-orange-200 dark:border-orange-500/30">
                            <AlertCircle size={14} className="mr-1" /> 缺代理人
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button className="px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20 rounded-lg text-xs font-bold transition-colors">
                            補齊文件
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= Modals 區塊 ================= */}
      
      {/* Modal: 新增人員 */}
      {isAddPersonModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
              <div className="flex items-center space-x-4">
                <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center">
                  <Plus size={20} className="mr-2 text-indigo-500" />
                  新增計畫人員
                </h3>
                <input type="file" ref={personFileInputRef} accept=".csv" className="hidden" onChange={handlePersonFileUpload} />
                <div className="flex space-x-2">
                  <button 
                    onClick={exportPersonCSVTemplate} 
                    className="flex items-center px-3 py-1.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-xs font-bold text-slate-700 dark:text-slate-300 rounded-lg hover:shadow-sm transition-all"
                  >
                    <Download size={14} className="mr-1.5 text-indigo-500 dark:text-indigo-400" />
                    下載 CSV 範例
                  </button>
                  <button 
                    onClick={() => personFileInputRef.current?.click()} 
                    disabled={isImportingPerson}
                    className="flex items-center px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 text-xs font-bold text-indigo-700 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-all"
                  >
                    {isImportingPerson ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Upload size={14} className="mr-1.5" />}
                    批次匯入人員
                  </button>
                </div>
              </div>
              <button onClick={() => setIsAddPersonModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              {availableUnits.length === 0 ? (
                <div className="p-6 bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 rounded-2xl border border-orange-200 dark:border-orange-500/30 text-center">
                  <AlertCircle size={32} className="mx-auto mb-3 text-orange-500" />
                  <p className="font-bold text-sm">請先建立「計畫人力需求設定」</p>
                  <p className="text-xs mt-2">系統需依據人力需求清單，提供單位與職位選項，以確保人員建檔合規。</p>
                </div>
              ) : (
                <form id="addPersonForm" onSubmit={handleAddPerson} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 md:col-span-1">
                      <label className="block text-xs font-bold text-slate-500 mb-1">姓名 <span className="text-red-500">*</span></label>
                      <input required type="text" value={newPerson.name} onChange={e => setNewPerson({...newPerson, name: e.target.value})} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      <label className="block text-xs font-bold text-slate-500 mb-1">Email</label>
                      <div className="relative">
                        <Mail size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                        <input type="email" value={newPerson.email} onChange={e => setNewPerson({...newPerson, email: e.target.value})} placeholder="需與系統登入帳號一致" className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none" />
                      </div>
                    </div>
                    
                    <div className="col-span-2 md:col-span-1">
                      <label className="block text-xs font-bold text-slate-500 mb-1 text-indigo-600 dark:text-indigo-400">所屬計畫單位 <span className="text-red-500">*</span></label>
                      <select required value={newPerson.unit} onChange={e => setNewPerson({...newPerson, unit: e.target.value, role: '', isResident: false})} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-indigo-200 dark:border-indigo-500/30 rounded-lg text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none">
                        <option value="">-- 請選擇單位 --</option>
                        {availableUnits.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      <label className="block text-xs font-bold text-slate-500 mb-1 text-indigo-600 dark:text-indigo-400">目前職位 <span className="text-red-500">*</span></label>
                      <select required value={newPerson.role} onChange={e => {
                        const selectedRole = e.target.value;
                        const req = requirements.find(r => r.unit === newPerson.unit && r.position === selectedRole);
                        setNewPerson({...newPerson, role: selectedRole, isResident: req ? req.isResident : false});
                      }} disabled={!newPerson.unit} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-indigo-200 dark:border-indigo-500/30 rounded-lg text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-50">
                        <option value="">-- 請選擇職位 --</option>
                        {addAvailablePositions.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2 md:col-span-1 flex flex-col justify-end pb-1.5">
                      {newPerson.role && (
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">駐點狀態：</span>
                          <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${newPerson.isResident ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                            {newPerson.isResident ? '✅ 駐點人員' : '❌ 非駐點人員'}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    {/* 分隔線 */}
                    <div className="col-span-2 my-1 border-t border-slate-100 dark:border-slate-700"></div>

                    <div className="col-span-2 md:col-span-1">
                      <label className="block text-xs font-bold text-slate-500 mb-1">計畫參與開始日 <span className="text-red-500">*</span></label>
                      <input required type="date" value={newPerson.contractStart} onChange={e => setNewPerson({...newPerson, contractStart: e.target.value})} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      <label className="block text-xs font-bold text-slate-500 mb-1">計畫參與結束日 <span className="text-slate-400">(留空視為在職)</span></label>
                      <input type="date" value={newPerson.contractEnd} onChange={e => setNewPerson({...newPerson, contractEnd: e.target.value})} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>

                    <div className="col-span-2 md:col-span-1">
                      <label className="block text-xs font-bold text-slate-500 mb-1">最初到職日 <span className="text-red-500">*</span></label>
                      <input required type="date" value={newPerson.hireDate} onChange={e => setNewPerson({...newPerson, hireDate: e.target.value})} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      <label className="block text-xs font-bold text-slate-500 mb-1">就任此職位日 <span className="text-red-500">*</span></label>
                      <input required type="date" value={newPerson.roleStartDate} onChange={e => setNewPerson({...newPerson, roleStartDate: e.target.value})} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                  </div>
                </form>
              )}
            </div>
            {availableUnits.length > 0 && (
              <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex justify-end space-x-3">
                <button onClick={() => setIsAddPersonModalOpen(false)} className="px-4 py-2 text-slate-600 dark:text-slate-300 text-sm font-bold hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">取消</button>
                <button type="submit" form="addPersonForm" className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 transition-colors flex items-center">
                  <Save size={16} className="mr-2" /> 儲存人員
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: 綜合維護與編輯人員資料 (含轉任歷史) */}
      {editingPerson && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 w-full max-w-4xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
              <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center">
                <Edit2 size={20} className="mr-2 text-indigo-500" />
                編輯人員資料與歷程 - {editingPerson.name}
              </h3>
              <button onClick={() => setEditingPerson(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-900/20">
              <form id="editPersonForm" onSubmit={handleSaveEditPerson} className="space-y-8">
                
                {/* 基本資料區 */}
                <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                  <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">1. 人員基本資料</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">姓名 <span className="text-red-500">*</span></label>
                      <input type="text" value={editingPerson.name} onChange={e=>setEditingPerson({...editingPerson, name: e.target.value})} required className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">Email</label>
                      <input type="email" value={editingPerson.email || ''} onChange={e=>setEditingPerson({...editingPerson, email: e.target.value})} placeholder="系統綁定帳號用" className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">最初到職日 <span className="text-red-500">*</span></label>
                      <input type="date" value={editingPerson.hireDate} onChange={e=>setEditingPerson({...editingPerson, hireDate: e.target.value})} required className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-indigo-500" />
                    </div>
                    
                    <div className="col-span-1 md:col-span-4 border-t border-slate-100 dark:border-slate-700 my-2"></div>

                    <div>
                      <label className="block text-[10px] font-bold text-indigo-600 dark:text-indigo-400 mb-1">計畫參與開始日</label>
                      <input type="date" value={editingPerson.contractStart} onChange={e=>setEditingPerson({...editingPerson, contractStart: e.target.value})} className="w-full px-3 py-2 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-500/30 rounded-lg text-sm outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-indigo-600 dark:text-indigo-400 mb-1">
                        計畫參與結束日 <span className="text-red-500">(決定在離職)</span>
                      </label>
                      <input type="date" value={editingPerson.contractEnd} onChange={e=>setEditingPerson({...editingPerson, contractEnd: e.target.value})} className="w-full px-3 py-2 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-500/30 rounded-lg text-sm outline-none focus:border-indigo-500" />
                      <p className="text-[10px] text-slate-400 mt-1">留空為「在職」，過去日期為「已離職」。</p>
                    </div>
                  </div>
                </div>

                {/* 職務與轉任歷程區 */}
                <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                  <div className="flex justify-between items-center mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                    <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200">2. 職務與轉任歷程</h4>
                    <button 
                      type="button" 
                      onClick={() => {
                        const currentHistory = editingPerson.history || [];
                        const updatedHistory = [...currentHistory];
                        let nextStartDate = today;

                        // 【智慧轉任自動填充】：確保新職務開始日不與舊職務衝突
                        if (updatedHistory.length > 0) {
                          updatedHistory.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
                          const lastRecord = updatedHistory[updatedHistory.length - 1];
                          
                          if (!lastRecord.endDate) {
                            // 自動把上一筆的結束日押在「昨天」
                            const prevEnd = new Date();
                            prevEnd.setDate(prevEnd.getDate() - 1);
                            lastRecord.endDate = prevEnd.toISOString().split('T')[0];
                            nextStartDate = today;
                          } else {
                            // 自動把新職務押在「結束日隔天」
                            const nextStart = new Date(lastRecord.endDate);
                            nextStart.setDate(nextStart.getDate() + 1);
                            nextStartDate = nextStart.toISOString().split('T')[0];
                          }
                        }

                        updatedHistory.push({ unit: '', role: '', startDate: nextStartDate, endDate: '' });
                        setEditingPerson({...editingPerson, history: updatedHistory});
                      }} 
                      className="text-xs text-indigo-600 dark:text-indigo-400 font-bold flex items-center bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Plus size={14} className="mr-1"/> 轉任紀錄
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    {(editingPerson.history || []).map((record, index) => (
                      <div key={index} className="p-4 border border-slate-200 dark:border-slate-700 rounded-xl relative bg-slate-50 dark:bg-slate-900/50 group hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-colors">
                        <button 
                          type="button" 
                          onClick={() => {
                            const newHistory = editingPerson.history.filter((_, i) => i !== index);
                            setEditingPerson({...editingPerson, history: newHistory});
                          }} 
                          className="absolute top-2 right-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 p-1.5 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                          title="刪除此歷程"
                        >
                          <Trash2 size={16}/>
                        </button>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pr-8">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 mb-1">計畫單位 <span className="text-red-500">*</span></label>
                            <select 
                              value={record.unit} 
                              onChange={e=>{
                                const newHistory = [...editingPerson.history];
                                newHistory[index].unit = e.target.value;
                                newHistory[index].role = ''; // 重置職位
                                setEditingPerson({...editingPerson, history: newHistory});
                              }} 
                              required 
                              className="w-full px-2 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs outline-none focus:border-indigo-500"
                            >
                              <option value="">請選擇單位</option>
                              {availableUnits.map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 mb-1">職務 <span className="text-red-500">*</span></label>
                            <select 
                              value={record.role} 
                              onChange={e=>{
                                const newHistory = [...editingPerson.history];
                                newHistory[index].role = e.target.value;
                                setEditingPerson({...editingPerson, history: newHistory});
                              }} 
                              required 
                              disabled={!record.unit}
                              className="w-full px-2 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs outline-none focus:border-indigo-500 disabled:opacity-50"
                            >
                              <option value="">請選擇職務</option>
                              {getPositionsForUnit(record.unit).map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 mb-1">區間開始日 <span className="text-red-500">*</span></label>
                            <input 
                              type="date" 
                              value={record.startDate} 
                              onChange={e=>{
                                const newHistory = [...editingPerson.history];
                                newHistory[index].startDate = e.target.value;
                                setEditingPerson({...editingPerson, history: newHistory});
                              }} 
                              required 
                              className="w-full px-2 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs outline-none focus:border-indigo-500"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 mb-1">區間結束日 <span className="text-slate-400">(留空為至今)</span></label>
                            <input 
                              type="date" 
                              value={record.endDate || ''} 
                              onChange={e=>{
                                const newHistory = [...editingPerson.history];
                                newHistory[index].endDate = e.target.value;
                                setEditingPerson({...editingPerson, history: newHistory});
                              }} 
                              className="w-full px-2 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs outline-none focus:border-indigo-500"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    {(!editingPerson.history || editingPerson.history.length === 0) && (
                      <div className="text-center p-4 border border-dashed border-red-200 dark:border-red-500/30 rounded-xl bg-red-50 dark:bg-red-500/10">
                        <p className="text-xs text-red-500 dark:text-red-400 font-bold">請至少新增一筆有效的職務歷程紀錄。</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 相關檔案與證明區塊 */}
                <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                  <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2 flex items-center">
                    <FileText size={16} className="mr-2 text-indigo-500" /> 3. 相關檔案與證明
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {editingPerson.files && editingPerson.files.length > 0 ? (
                      editingPerson.files.map(file => (
                        <div key={file.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm hover:border-indigo-300 dark:hover:border-indigo-500/50 transition-colors">
                          <div className="flex items-center truncate max-w-[80%]">
                            <FileIcon size={16} className="text-indigo-400 mr-2 flex-shrink-0" />
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate" title={file.name}>{file.name}</span>
                          </div>
                          <button type="button" className="p-1.5 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 dark:text-indigo-400 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/30 rounded-lg transition-colors" title="下載檔案">
                            <Download size={14} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="col-span-1 sm:col-span-2 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-center">
                        <p className="text-xs text-slate-500 dark:text-slate-400">目前尚無上傳任何相關檔案 (如：畢業證書、經歷證明)。</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">請在人員名冊列表中點擊上傳按鈕補齊檔案。</p>
                      </div>
                    )}
                  </div>
                </div>

              </form>
            </div>
            
            <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex justify-end space-x-3">
              <button onClick={() => setEditingPerson(null)} className="px-5 py-2 text-slate-600 dark:text-slate-300 text-sm font-bold hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">取消</button>
              <button type="submit" form="editPersonForm" className="px-6 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 transition-colors flex items-center shadow-sm">
                <Save size={16} className="mr-2" /> 儲存所有變更
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: 人力需求設定 */}
      {isReqModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 w-full max-w-5xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
              <div className="flex items-center space-x-4">
                <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center">
                  <Settings size={20} className="mr-2 text-indigo-500" />
                  設定計畫人力需求 ({projectName || '載入中...'})
                </h3>
                {/* 隱藏的檔案匯入 input */}
                <input type="file" ref={reqFileInputRef} accept=".csv" className="hidden" onChange={handleReqFileUpload} />
                <div className="flex space-x-2">
                  <button 
                    onClick={exportReqCSVTemplate} 
                    className="flex items-center px-3 py-1.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-xs font-bold text-slate-700 dark:text-slate-300 rounded-lg hover:shadow-sm transition-all"
                  >
                    <Download size={14} className="mr-1.5 text-indigo-500 dark:text-indigo-400" />
                    下載 CSV 範例
                  </button>
                  <button 
                    onClick={() => reqFileInputRef.current?.click()} 
                    disabled={isImportingReq}
                    className="flex items-center px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 text-xs font-bold text-indigo-700 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-all"
                  >
                    {isImportingReq ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Upload size={14} className="mr-1.5" />}
                    批次匯入需求
                  </button>
                </div>
              </div>
              <button onClick={() => setIsReqModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-900/20">
              <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-indigo-100 dark:border-indigo-500/20 mb-6 shadow-sm">
                <h4 className="font-bold text-sm text-indigo-800 dark:text-indigo-400 mb-3 flex items-center">
                  <Plus size={16} className="mr-1" /> 新增需求區間
                </h4>
                <form onSubmit={handleAddReq}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-start mb-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">計畫單位</label>
                      <input required type="text" value={newReq.unit} onChange={e=>setNewReq({...newReq, unit: e.target.value})} placeholder="ex. 專案辦公室" className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">要求職位</label>
                      <input required type="text" value={newReq.position} onChange={e=>setNewReq({...newReq, position: e.target.value})} placeholder="ex. 專員" className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">需求人數</label>
                      <input required type="number" min="1" value={newReq.count} onChange={e=>setNewReq({...newReq, count: e.target.value})} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1 text-indigo-600 dark:text-indigo-400">是否為駐點職缺</label>
                      <select required value={newReq.isResident} onChange={e=>setNewReq({...newReq, isResident: e.target.value === 'true'})} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-indigo-200 dark:border-indigo-500/30 rounded-lg text-sm outline-none focus:border-indigo-500">
                        <option value="true">是 (駐點人員)</option>
                        <option value="false">否 (非駐點人員)</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-start mb-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1 text-indigo-600 dark:text-indigo-400">需求開始日</label>
                      <input required type="date" value={newReq.startDate} onChange={e=>setNewReq({...newReq, startDate: e.target.value})} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-indigo-200 dark:border-indigo-500/30 rounded-lg text-sm outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1 text-indigo-600 dark:text-indigo-400">需求結束日</label>
                      <input required type="date" value={newReq.endDate} onChange={e=>setNewReq({...newReq, endDate: e.target.value})} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-indigo-200 dark:border-indigo-500/30 rounded-lg text-sm outline-none focus:border-indigo-500" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-bold text-slate-500 mb-1 text-indigo-600 dark:text-indigo-400">額外需求說明 (選填)</label>
                      <textarea 
                        value={newReq.note} 
                        onChange={e=>setNewReq({...newReq, note: e.target.value})} 
                        placeholder="請輸入特殊條件、備註或其他詳細需求說明..." 
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-indigo-200 dark:border-indigo-500/30 rounded-lg text-sm outline-none focus:border-indigo-500 resize-y min-h-[80px]" 
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button type="submit" className="px-6 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm">
                      加入設定
                    </button>
                  </div>
                </form>
              </div>

              <h4 className="font-bold text-sm text-slate-700 dark:text-slate-300 mb-3">已建立的需求區間</h4>
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase">單位/職位</th>
                      <th className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase">要求人數</th>
                      <th className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase">駐點屬性</th>
                      <th className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase max-w-[200px]">額外需求說明</th>
                      <th className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase">有效區間</th>
                      <th className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase text-center">目前狀態</th>
                      <th className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                    {requirements.length === 0 ? (
                      <tr><td colSpan="7" className="py-8 text-center text-xs text-slate-500">尚無任何人力需求設定</td></tr>
                    ) : (
                      requirements.sort((a,b) => new Date(a.startDate) - new Date(b.startDate)).map(req => {
                        const isActiveToday = req.startDate <= today && req.endDate >= today;
                        return (
                          <tr key={req.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                            <td className="py-3 px-4">
                              <div className="font-bold text-sm text-slate-800 dark:text-slate-200">{req.position}</div>
                              <div className={`text-[10px] font-bold px-2 py-0.5 rounded border w-fit mt-0.5 ${getUnitColorClass(req.unit)}`}>{req.unit}</div>
                            </td>
                            <td className="py-3 px-4 text-sm font-bold text-indigo-600 dark:text-indigo-400">{req.count} <span className="text-[10px] font-normal text-slate-500">人</span></td>
                            <td className="py-3 px-4 text-xs font-bold text-slate-600 dark:text-slate-400">
                              {req.isResident ? <span className="text-indigo-600 dark:text-indigo-400">是</span> : <span className="text-slate-400">否</span>}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400 truncate max-w-[200px]" title={req.note}>{req.note || '-'}</td>
                            <td className="py-3 px-4 text-xs font-medium text-slate-600 dark:text-slate-400">{req.startDate} ~ {req.endDate}</td>
                            <td className="py-3 px-4 text-center">
                              {isActiveToday 
                                ? <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px] font-bold rounded">現正要求中</span>
                                : <span className="px-2 py-0.5 bg-slate-100 text-slate-500 dark:bg-slate-700 text-[10px] font-bold rounded">非現行區間</span>
                              }
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button onClick={() => handleDeleteReq(req.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors">
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: 未來異動預測與職缺空窗警告 */}
      {isForecastModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 w-full max-w-4xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
              <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center">
                <LineChart size={20} className="mr-2 text-indigo-500" />
                近期異動與空窗預測分析 (未來 60 天內)
              </h3>
              <button onClick={() => setIsForecastModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-900/20 space-y-8">
              
              {/* 預估的人員與需求異動 */}
              <div>
                <h4 className="text-base font-bold text-slate-800 dark:text-slate-200 mb-4 flex items-center border-b border-slate-200 dark:border-slate-700 pb-2">
                  <ArrowUpDown size={18} className="mr-2 text-slate-400" /> 系統分析之未來事件預演
                </h4>
                {upcomingEvents.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400 italic bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-center">未來 60 天內無已知的變動。</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {upcomingEvents.map((evt, idx) => {
                      const isResolved = evt.replacements && evt.replacements.length > 0;
                      
                      let bgClass = '';
                      if (isResolved || evt.type === 'onboard' || evt.type === 'transfer_in') {
                        bgClass = 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/10 dark:border-emerald-500/30 text-emerald-600';
                      } else if (evt.type === 'leave' || evt.type === 'transfer_out') {
                        bgClass = 'bg-red-50 border-red-200 dark:bg-red-900/10 dark:border-red-500/30 text-red-600';
                      } else {
                        bgClass = 'bg-amber-50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-500/30 text-amber-600';
                      }

                      return (
                        <div key={idx} className={`p-4 rounded-xl border flex items-start shadow-sm transition-colors ${
                          isResolved ? 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-500/30' 
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                        }`}>
                          <div className={`p-2 rounded-lg mr-3 flex-shrink-0 ${bgClass}`}>
                             {isResolved ? <CheckCircle2 size={18} /> : <CalendarDays size={18} />}
                          </div>
                          <div className="flex-1">
                             <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-0.5">預計發生日：{evt.date}</p>
                             <p className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">{evt.desc}</p>
                             {isResolved && (
                               <div className="inline-flex items-center text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30 px-2 py-1 rounded mt-1 border border-emerald-200 dark:border-emerald-500/30">
                                  ✅ 已安排補位：{evt.replacements.map(r => r.name).join(', ')}
                               </div>
                             )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 未來空窗推演結果 */}
              <div>
                <h4 className="text-base font-bold text-orange-600 dark:text-orange-400 mb-2 flex items-center border-b border-orange-200 dark:border-orange-500/30 pb-2">
                  <AlertCircle size={18} className="mr-2" /> 系統推演之未來職位空缺預警
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
                  依據上述已知變動進行推演，若不即時補齊人力，下列職務將在特定日期產生空缺斷層：
                  <br/><span className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold mt-1 inline-block">💡 提示：若某人員離職，但下方未出現空缺警示，表示該職位「已有其他人員重疊交接中，滿足總量需求」或「該需求區間已到期」。</span>
                </p>
                
                {futureVacancies.length === 0 ? (
                  <div className="text-center py-8 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <CheckCircle2 size={32} className="mx-auto mb-2 text-emerald-500 opacity-50" />
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">未來 60 天內無推演出任何人力空窗危機。</p>
                    <p className="text-xs text-slate-500 mt-1">目前已知的離職與轉任皆已有替補人員銜接。</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {futureVacancies.map((fv, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-white dark:bg-slate-800 border-l-4 border-l-orange-500 border border-slate-200 dark:border-slate-700 p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{fv.unit} - {fv.role}</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tracking-tight">
                            空窗區間：{fv.startDate} ~ {fv.endDate}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 px-3 py-1.5 rounded-lg border border-orange-100 dark:border-orange-500/30">
                            預計缺少 {fv.missingCount} 人
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
            
            <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex justify-end space-x-3">
              <button onClick={() => setIsForecastModalOpen(false)} className="px-6 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl transition-colors shadow-sm hover:bg-indigo-700">
                了解，關閉視窗
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: 今日職位空缺明細 (詳細卡片版) */}
      {isVacancyModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 w-full max-w-4xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
              <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center">
                <CalendarDays size={20} className="mr-2 text-orange-500" />
                今日職位異常空缺明細分析
              </h3>
              <button onClick={() => setIsVacancyModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50 dark:bg-slate-900/20 space-y-6">
              {vacancyBreakdown.length === 0 ? (
                <div className="py-12 text-center text-slate-500">
                  <CheckCircle2 size={48} className="mx-auto mb-4 text-emerald-400 opacity-50" />
                  <p className="font-bold text-lg">目前無職位空缺異常</p>
                  <p className="text-sm mt-2">各項計畫人力需求皆已補齊。</p>
                </div>
              ) : (
                vacancyBreakdown.map((item, idx) => (
                  <div key={idx} className="bg-white dark:bg-slate-800 rounded-2xl border border-orange-200 dark:border-orange-500/30 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                    
                    {/* 卡片標題區 */}
                    <div className="bg-orange-50 dark:bg-orange-500/10 p-4 border-b border-orange-100 dark:border-orange-500/20 flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center space-x-3 mb-1">
                          <span className="font-bold text-slate-800 dark:text-slate-200 text-base">{item.unit}</span>
                          <span className="text-slate-300 dark:text-slate-600">|</span>
                          <span className="font-bold text-indigo-700 dark:text-indigo-400 text-base">{item.position}</span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tracking-tight">
                          最高需求：{item.requiredCount} 人 <span className="mx-1">•</span> 區間：{item.reqStartDate} ~ {item.reqEndDate}
                        </div>
                      </div>
                      <div className="bg-white dark:bg-slate-800 px-4 py-2 rounded-xl border border-orange-100 dark:border-orange-500/30 flex items-center justify-center shadow-sm">
                        <span className="text-xs font-bold text-slate-500 mr-2">累計空缺：</span>
                        <span className="text-xl font-black text-orange-600 dark:text-orange-400">{item.totalVacancyDays} <span className="text-sm font-medium">人天</span></span>
                      </div>
                    </div>

                    {/* 明細內容區 */}
                    <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-8">
                      
                      {/* 左側：在職人員歷史 */}
                      <div>
                        <h5 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center border-b border-slate-100 dark:border-slate-700 pb-2">
                          <Users size={16} className="mr-2 text-slate-400" />
                          該期間內擔任過此職務之人員
                        </h5>
                        {item.personnelInRole.length === 0 ? (
                          <p className="text-sm text-slate-400 italic bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg text-center">此期間內尚無任何人員在職紀錄。</p>
                        ) : (
                          <ul className="space-y-3">
                            {item.personnelInRole.map((p, pIdx) => (
                              <li key={pIdx} className="bg-slate-50 dark:bg-slate-700/30 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                                <div className="font-bold text-sm text-slate-800 dark:text-slate-200 mb-1">{p.name}</div>
                                <div className="space-y-1">
                                  {p.periods.map((per, perIdx) => (
                                    <div key={perIdx} className="text-xs text-slate-500 dark:text-slate-400 flex items-center font-mono">
                                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-2"></div>
                                      {per.start} <ChevronRight size={12} className="mx-1" /> {per.end}
                                    </div>
                                  ))}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* 右側：確切的斷層區段 */}
                      <div>
                        <h5 className="text-sm font-bold text-orange-600 dark:text-orange-400 mb-3 flex items-center border-b border-orange-100 dark:border-orange-500/20 pb-2">
                          <AlertCircle size={16} className="mr-2" />
                          確切的人力空窗區段
                        </h5>
                        <ul className="space-y-3">
                          {item.vacancyPeriods.map((vp, vpIdx) => (
                            <li key={vpIdx} className="flex items-center justify-between bg-white dark:bg-slate-800 border border-orange-200 dark:border-orange-500/30 p-3 rounded-xl shadow-sm relative overflow-hidden">
                              <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-400"></div>
                              <div className="flex flex-col ml-2">
                                <span className="text-slate-800 dark:text-slate-200 font-bold text-sm font-mono tracking-tight mb-0.5">
                                  {vp.startDate} <ChevronRight size={12} className="inline text-slate-400 mx-0.5" /> {vp.endDate}
                                </span>
                                <span className="text-xs font-bold text-orange-500 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 px-2 py-0.5 rounded w-fit mt-1">
                                  缺少 {vp.missingCount} 人
                                </span>
                              </div>
                              <div className="text-right flex flex-col items-end">
                                <span className="text-lg font-black text-orange-600 dark:text-orange-400">{vp.days}</span>
                                <span className="text-[10px] text-slate-400">天</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                      
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex justify-end">
              <button 
                onClick={() => setIsVacancyModalOpen(false)} 
                className="px-6 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-white text-slate-700 text-sm font-bold rounded-xl transition-colors"
              >
                關閉明細
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
