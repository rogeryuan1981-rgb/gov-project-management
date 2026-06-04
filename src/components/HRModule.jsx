import React, { useState, useEffect, useRef } from 'react';
import { Users, Plus, Settings, X, Save, Trash2, PieChart, Edit2, FileText, Download, Loader2, File as FileIcon, Mail, ArrowUpDown, ArrowUp, ArrowDown, Filter, ExternalLink, Check, ListChecks, AlertCircle } from 'lucide-react';
import { collection, onSnapshot, doc, addDoc, deleteDoc, updateDoc, getFirestore } from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';

const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

const DRIVE_CLIENT_ID = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) 
  || '134813517167-s4t64mucti470adauc6mvpbrtn0ncont.apps.googleusercontent.com';

const getOrCreateFolder = async (folderName, parentId, accessToken) => {
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (searchRes.status === 401) throw new Error('UNAUTHORIZED');
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) return searchData.files[0];
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
  });
  if (createRes.status === 401) throw new Error('UNAUTHORIZED');
  return await createRes.json();
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

export default function HRModule({ user, selectedProject }) {
  const [personnel, setPersonnel] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [dbError, setDbError] = useState(null); 
  const [projectData, setProjectData] = useState({});
  const [projectName, setProjectName] = useState(''); 
  
  const [isAddPersonModalOpen, setIsAddPersonModalOpen] = useState(false);
  const [isSidebarOpen, setIsReqModalOpen] = useState(false); 
  const [isVacancyModalOpen, setIsVacancyModalOpen] = useState(false); 
  const [isForecastModalOpen, setIsForecastModalOpen] = useState(false); 
  
  const [editingPerson, setEditingPerson] = useState(null);
  const reqFileInputRef = useRef(null);
  const personFileInputRef = useRef(null);
  const [isImportingReq, setIsImportingReq] = useState(false);
  const [isImportingPerson, setIsImportingPerson] = useState(false);
  const [uploadingPersonnelId, setUploadingPersonnelId] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [selectedUnitFilter, setSelectedUnitFilter] = useState('ALL');

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

  const [newPerson, setNewPerson] = useState({
    name: '', email: '', role: '', unit: '', isResident: true, hireDate: '', roleStartDate: '', proxyAlert: false,
    contractStart: defaultStartDate, contractEnd: '', files: []
  });
  
  const [newReq, setNewReq] = useState({
    unit: '', position: '', startDate: defaultStartDate, penaltyStartDate: defaultStartDate, endDate: defaultEndDate, count: 1, isResident: true, noteItems: ['']
  });

  const tokenClientRef = useRef(null);

  useEffect(() => {
    const initGis = () => {
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: DRIVE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (tokenResponse) => {
          if (tokenResponse && tokenResponse.access_token) {
            localStorage.setItem('google_drive_access_token', tokenResponse.access_token);
            alert("✅ 雲端硬碟授權成功！");
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
    }, (error) => { if (error.code === 'permission-denied') setDbError('【權限不足】讀取失敗'); });

    const unsubReq = onSnapshot(reqRef, (snapshot) => {
      const loadedReqs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const projectReqs = loadedReqs.filter(r => r.projectId === selectedProject);
      setRequirements(projectReqs);
    }, (error) => { if (error.code === 'permission-denied') setDbError('【權限不足】讀取失敗'); });

    return () => { unsubHR(); unsubReq(); };
  }, [user, selectedProject]);

  const getPersonStatus = (p) => {
    const startMs = new Date(p.contractStart || p.hireDate).getTime();
    const endMs = p.contractEnd ? new Date(p.contractEnd).getTime() : Infinity;
    if (startMs > todayMs) return 'pending';
    if (endMs < todayMs) return 'inactive'; 
    return 'active';
  };

  const availableUnits = [...new Set(requirements.map(r => r.unit))].filter(Boolean);
  const allExistingUnits = [...new Set([...availableUnits, ...personnel.map(p => p.unit)])].filter(Boolean);
  
  const getUnitColorClass = (unitName) => {
    if (!unitName) return 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
    const index = allExistingUnits.indexOf(unitName);
    return index !== -1 ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-slate-50 text-slate-500';
  };

  const getPositionsForUnit = (unit) => [...new Set(requirements.filter(r => r.unit === unit).map(r => r.position))].filter(Boolean);
  const addAvailablePositions = getPositionsForUnit(newPerson.unit);

  const filteredPersonnel = personnel.filter(p => selectedUnitFilter === 'ALL' || p.unit === selectedUnitFilter);

  const sortedPersonnel = [...filteredPersonnel].sort((a, b) => {
    if (!sortConfig.key) return 0;
    let aVal = a[sortConfig.key] || '', bVal = b[sortConfig.key] || '';
    return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  });

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };
  const SortIcon = ({ columnKey }) => (
    <ArrowUpDown size={14} className={`inline ml-1 ${sortConfig.key === columnKey ? 'text-indigo-500' : 'text-slate-300'}`} />
  );

  const handleAddPerson = async (e) => {
    e.preventDefault();
    if (!newPerson.name || !newPerson.role || !newPerson.unit || !newPerson.hireDate) return;
    try {
      const hrRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'personnel');
      const initialHistory = [{ unit: newPerson.unit, role: newPerson.role, startDate: newPerson.roleStartDate || newPerson.hireDate, endDate: '' }];
      await addDoc(hrRef, { ...newPerson, history: initialHistory, projectId: selectedProject, createdAt: new Date().getTime() });
      setIsAddPersonModalOpen(false);
    } catch (e) { console.error(e); }
  };

  const exportCurrentPersonnelCSV = () => {
    const headers = ['姓名', 'Email', '計畫單位', '目前職位', '駐點狀態', '在職狀態', '最初到職日'];
    const rows = sortedPersonnel.map(p => [p.name, p.email, p.unit, p.role, p.isResident ? '是' : '否', getPersonStatus(p), p.hireDate].join(','));
    const blob = new Blob(["\uFEFF" + [headers.join(','), ...rows].join('\n')], { type: 'text/csv' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `現況人員清冊.csv`;
    link.click();
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {dbError && <div className="bg-red-50 p-4 text-red-700 font-bold rounded-xl">{dbError}</div>}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">人事合規紀錄中心 ({projectName})</h2>
        </div>
        <button onClick={handleOpenAddPersonModal} className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm">新增人員</button>
      </div>
      {/* 這裡是您精簡過後的人事表單與列表，已徹底移除考勤邏輯 */}
      <div className="bg-white p-6 rounded-2xl border">
        {/* 表格省略，您可保持原樣 */}
      </div>
      {/* 僅保留人事相關彈窗 */}
      {isAddPersonModalOpen && <div /* 人員新增 Modal ... */ />}
      {editingPerson && <div /* 人員編輯 Modal ... */ />}
    </div>
  );
}
