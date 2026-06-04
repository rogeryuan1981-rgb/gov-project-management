import React, { useState, useEffect, useRef } from 'react';
import { Users, CheckCircle2, AlertCircle, Upload, Plus, Settings, X, Save, Trash2, PieChart, Edit2, FileText, Download, Loader2, File as FileIcon, CalendarDays, Mail, ArrowUpDown, ArrowUp, ArrowDown, Filter, ChevronRight, LineChart, ExternalLink, Check, ListChecks, Clock } from 'lucide-react';
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
  if (searchData.files && searchData.files.length > 0) { return searchData.files[0]; } else {
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
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

export default function HRModule({ user, selectedProject }) {
  const [personnel, setPersonnel] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [dbError, setDbError] = useState(null); 
  const [projectData, setProjectData] = useState({});
  const [projectName, setProjectName] = useState(''); 
  const [activeSubTab, setActiveSubTab] = useState('hr'); 
  const [isAddPersonModalOpen, setIsAddPersonModalOpen] = useState(false);
  const [isReqModalOpen, setIsReqModalOpen] = useState(false);
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

  const [newPerson, setNewPerson] = useState({ name: '', email: '', role: '', unit: '', isResident: true, hireDate: '', roleStartDate: '', proxyAlert: false, contractStart: defaultStartDate, contractEnd: '', files: [] });
  const [newReq, setNewReq] = useState({ unit: '', position: '', startDate: defaultStartDate, penaltyStartDate: defaultStartDate, endDate: defaultEndDate, count: 1, isResident: true, noteItems: [''] });
  const tokenClientRef = useRef(null);
  useEffect(() => {
    const initGis = () => {
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: DRIVE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (tokenResponse) => { if (tokenResponse && tokenResponse.access_token) { localStorage.setItem('google_drive_access_token', tokenResponse.access_token); alert("✅ 雲端硬碟授權成功！請再次上傳檔案。"); } },
      });
    };
    if (!window.google) { const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true; script.onload = initGis; document.body.appendChild(script); } else { initGis(); }
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    const projectRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'projects', selectedProject);
    const unsubscribe = onSnapshot(projectRef, (docSnap) => { if (docSnap.exists()) { setProjectData(docSnap.data()); setProjectName(docSnap.data().name); } });
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
    }, (error) => { if (error.code === 'permission-denied') setDbError('【權限不足】無法讀取人事資料'); });
    const unsubReq = onSnapshot(reqRef, (snapshot) => {
      const loadedReqs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const projectReqs = loadedReqs.filter(r => r.projectId === selectedProject);
      setRequirements(projectReqs);
    }, (error) => { if (error.code === 'permission-denied') setDbError('【權限不足】無法讀取人力需求'); });
    return () => { unsubHR(); unsubReq(); };
  }, [user, selectedProject]);

  const getPersonStatus = (p) => {
    const startMs = new Date(p.contractStart || p.hireDate).getTime();
    const endMs = p.contractEnd ? new Date(p.contractEnd).getTime() : Infinity;
    if (startMs > todayMs) return 'pending';
    if (endMs < todayMs) return 'inactive'; 
    return 'active';
  };

  const getUnitColorClass = (unitName) => {
    if (!unitName) return 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
    const index = allExistingUnits.indexOf(unitName);
    return index === -1 ? 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700' : UNIT_COLORS[index % UNIT_COLORS.length];
  };

  const getPositionsForUnit = (unit) => [...new Set(requirements.filter(r => r.unit === unit).map(r => r.position))].filter(Boolean);
  const addAvailablePositions = getPositionsForUnit(newPerson.unit);

  const filteredPersonnel = personnel.filter(p => selectedUnitFilter === 'ALL' || p.unit === selectedUnitFilter);
  const sortedPersonnel = [...filteredPersonnel].sort((a, b) => {
    if (!sortConfig.key) return 0;
    let aValue = '', bValue = '';
    switch (sortConfig.key) {
      case 'name': aValue = a.name || ''; bValue = b.name || ''; break;
      case 'status': const order = { 'active': 1, 'pending': 2, 'inactive': 3 }; aValue = `${order[getPersonStatus(a)]}-${a.isResident ? '1' : '0'}`; bValue = `${order[getPersonStatus(b)]}-${b.isResident ? '1' : '0'}`; break;
      case 'role': aValue = a.role || ''; bValue = b.role || ''; break;
      case 'roleDate': aValue = a.roleStartDate || a.hireDate || ''; bValue = b.roleStartDate || b.hireDate || ''; break;
      case 'date': aValue = a.contractStart || a.hireDate || ''; bValue = b.contractStart || b.hireDate || ''; break;
      default: break;
    }
    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown size={14} className="inline ml-1 text-slate-300 dark:text-slate-600" />;
    return sortConfig.direction === 'asc' ? <ArrowUp size={14} className="inline ml-1 text-indigo-500" /> : <ArrowDown size={14} className="inline ml-1 text-indigo-500" />;
  };

  const handleOpenAddPersonModal = () => {
    setNewPerson({ name: '', email: '', role: '', unit: '', isResident: true, hireDate: '', roleStartDate: '', proxyAlert: false, contractStart: defaultStartDate, contractEnd: '', files: [] });
    setIsAddPersonModalOpen(true);
  };
  const handleOpenReqModal = () => {
    setNewReq({ unit: '', position: '', startDate: defaultStartDate, penaltyStartDate: defaultStartDate, endDate: defaultEndDate, count: 1, isResident: true, noteItems: [''] });
    setIsReqModalOpen(true);
  };

  const formatImportDate = (dateStr) => {
    if (!dateStr || dateStr.trim() === '') return '';
    let s = dateStr.trim().replace(/\//g, '-');
    const parts = s.split('-');
    if (parts.length === 3 && parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    return s;
  };

  const handleAddPerson = async (e) => {
    e.preventDefault();
    if (!newPerson.name || !newPerson.role || !newPerson.unit || !newPerson.hireDate) { alert('請填寫必填欄位'); return; }
    try {
      const hrRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'personnel');
      const initialHistory = [{ unit: newPerson.unit, role: newPerson.role, startDate: newPerson.roleStartDate || newPerson.hireDate, endDate: '' }];
      await addDoc(hrRef, { ...newPerson, roleStartDate: newPerson.roleStartDate || newPerson.hireDate, history: initialHistory, fulfilledReqs: [], projectId: selectedProject, createdAt: new Date().getTime() });
      setIsAddPersonModalOpen(false);
    } catch (error) { console.error("新增人員失敗:", error); }
  };

  const handlePersonFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !user || !selectedProject) return;
    setIsImportingPerson(true);
    try {
      const text = await file.text();
      const rows = text.split('\n').filter(row => row.trim().length > 0);
      const isHeader = rows[0].includes('姓名');
      const hrRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'personnel');
      for (let i = isHeader ? 1 : 0; i < rows.length; i++) {
        const cols = rows[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        if (cols.length >= 4) {
          const name = cols[0]; const email = cols[1]; const unit = cols[2]; const role = cols[3];
          const hireDate = formatImportDate(cols[4]) || defaultStartDate;
          await addDoc(hrRef, { name, email, unit, role, hireDate, status: 'active', projectId: selectedProject, createdAt: new Date().getTime() });
        }
      }
      alert("✅ 匯入成功");
    } catch (error) { console.error(error); } finally { setIsImportingPerson(false); }
  };
  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-6xl mx-auto">
      {dbError && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-4 rounded-2xl flex items-start">
          <AlertCircle className="text-red-500 mr-3 flex-shrink-0 mt-0.5" size={20} />
          <div><h4 className="text-sm font-bold text-red-700 dark:text-red-400">系統異常</h4><p className="text-xs text-red-600 dark:text-red-300 mt-1">{dbError}</p></div>
        </div>
      )}

      <div className="flex justify-between items-center mb-2">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">人事合規紀錄中心 ({projectName || '載入中...'})</h2>
        </div>
        <button onClick={handleOpenAddPersonModal} className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-colors">新增同仁建檔</button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/80 border-b">
              <tr>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase cursor-pointer" onClick={() => handleSort('name')}>姓名 <SortIcon columnKey="name" /></th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase cursor-pointer" onClick={() => handleSort('status')}>狀態 <SortIcon columnKey="status" /></th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase">職位</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sortedPersonnel.map(u => (
                <tr key={u.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="py-4 px-6 font-bold">{u.name}</td>
                  <td className="py-4 px-6">{getPersonStatus(u)}</td>
                  <td className="py-4 px-6">{u.role}</td>
                  <td className="py-4 px-6 text-right">
                    <button onClick={() => handleOpenEditPerson(u)} className="text-indigo-600 text-xs font-bold">維護與檢視</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增人員 Modal */}
      {isAddPersonModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-3xl p-6 shadow-2xl">
            <div className="flex justify-between mb-4"><h3 className="font-bold text-lg">新增計畫人員</h3><button onClick={() => setIsAddPersonModalOpen(false)}><X /></button></div>
            <form id="addPersonForm" onSubmit={handleAddPerson} className="space-y-4">
              {/* 這裡填入您原本完整的表單欄位 */}
              <input type="text" placeholder="姓名" value={newPerson.name} onChange={e => setNewPerson({...newPerson, name: e.target.value})} className="w-full p-2 border rounded" />
              <div className="flex justify-end space-x-3">
                <button type="button" onClick={() => setIsAddPersonModalOpen(false)} className="px-4 py-2">取消</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded">儲存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 編輯人員 Modal */}
      {editingPerson && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-4xl rounded-3xl p-6 shadow-2xl">
             {/* 這裡填入您原本完整的編輯歷程表單 */}
             <form id="editPersonForm" onSubmit={handleSaveEditPerson}>
                <input type="text" value={editingPerson.name} onChange={e => setEditingPerson({...editingPerson, name: e.target.value})} className="w-full p-2 border rounded" />
                <div className="flex justify-end space-x-3">
                  <button type="button" onClick={() => setEditingPerson(null)} className="px-4 py-2">取消</button>
                  <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded">儲存所有變更</button>
                </div>
             </form>
          </div>
        </div>
      )}
    </div>
  );
}
