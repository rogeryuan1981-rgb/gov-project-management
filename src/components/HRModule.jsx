import React, { useState, useEffect } from 'react';
import { User, Image as ImageIcon, Star, Save, CheckCircle2, Loader2, Settings, Shield, Trash2, AlertTriangle, X, FolderTree, Plus, Edit2, Check, Calendar } from 'lucide-react';
import { updateProfile } from 'firebase/auth';
import { collection, onSnapshot, doc, deleteDoc, updateDoc, getFirestore } from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';

const firebaseConfig = typeof __firebase_config !== 'undefined' && __firebase_config ? JSON.parse(__firebase_config) : {};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

const globalAppId = typeof __app_id !== 'undefined' ? __app_id : 'gov-project-saas';

export default function SettingsModule({ user, favoriteIds, setFavoriteIds }) {
  // ================= 個人化設定狀態 =================
  const [avatarUrl, setAvatarUrl] = useState(user?.photoURL || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // ================= 專案管理與目錄設定狀態 =================
  const [projects, setProjects] = useState([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(null);

  // 歸檔目錄設定狀態
  const [editingFolderProjectId, setEditingFolderProjectId] = useState(null);
  const [projectFolders, setProjectFolders] = useState([]);
  const [isSavingFolders, setIsSavingFolders] = useState(false);

  // 修改專案詳細資訊狀態 (包含名稱與日期)
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [editingProjectStartDate, setEditingProjectStartDate] = useState('');
  const [editingProjectEndDate, setEditingProjectEndDate] = useState('');
  const [isUpdatingProject, setIsUpdatingProject] = useState(false);

  const ALL_MODULES = [
    { id: 'tasks', label: '工項與進度追蹤' },
    { id: 'hr', label: '人事合規紀錄' },
    { id: 'archive', label: '雲端歸檔空間' },
    { id: 'reimbursement', label: '核銷作業專區' },
  ];

  // 載入專案清單 (包含其歸檔目錄設定)
  useEffect(() => {
    if (!user) return;
    const projectsRef = collection(db, 'artifacts', globalAppId, 'public', 'data', 'projects');
    const unsubscribe = onSnapshot(projectsRef, (snapshot) => {
      const loadedProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      loadedProjects.sort((a, b) => a.createdAt - b.createdAt);
      setProjects(loadedProjects);
    });
    return () => unsubscribe();
  }, [user]);

  const handleToggleFavorite = (id) => {
    if (favoriteIds.includes(id)) {
      setFavoriteIds(favoriteIds.filter(f => f !== id));
    } else {
      setFavoriteIds([...favoriteIds, id]);
    }
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setSaveMessage('');
    try {
      if (user && avatarUrl !== user.photoURL) {
        await updateProfile(user, { photoURL: avatarUrl });
      }
      setSaveMessage('✅ 設定已成功儲存！頭貼將於下次重新載入後全面更新。');
    } catch (error) {
      console.error("更新設定失敗", error);
      setSaveMessage('❌ 儲存失敗，請確認您的網路連線或圖片網址是否有效。');
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(''), 5000);
    }
  };

  const handleDeleteProject = async (projectId) => {
    setIsDeleting(projectId);
    try {
      await deleteDoc(doc(db, 'artifacts', globalAppId, 'public', 'data', 'projects', projectId));
      setConfirmDeleteId(null);
      if (editingFolderProjectId === projectId) setEditingFolderProjectId(null);
    } catch (error) {
      console.error("刪除專案失敗:", error);
    } finally {
      setIsDeleting(null);
    }
  };

  // 打開目錄設定面板
  const handleOpenFolderSettings = (project) => {
    if (editingFolderProjectId === project.id) {
      setEditingFolderProjectId(null);
    } else {
      setEditingFolderProjectId(project.id);
      setProjectFolders(project.folders || [{ id: Date.now(), level1: '', level2: '' }]);
    }
  };

  const handleFolderChange = (id, field, value) => {
    setProjectFolders(prev => prev.map(f => f.id === id ? { ...f, [field]: value } : f));
  };

  const handleAddFolderRow = () => {
    setProjectFolders(prev => [...prev, { id: Date.now(), level1: '', level2: '' }]);
  };

  const handleRemoveFolderRow = (id) => {
    setProjectFolders(prev => prev.filter(f => f.id !== id));
  };

  const handleSaveFolders = async (projectId) => {
    setIsSavingFolders(true);
    try {
      const validFolders = projectFolders.filter(f => f.level1.trim() !== '');
      const projectRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'projects', projectId);
      await updateDoc(projectRef, { folders: validFolders });
      setEditingFolderProjectId(null);
    } catch (error) {
      console.error("儲存目錄設定失敗:", error);
    } finally {
      setIsSavingFolders(false);
    }
  };

  // 準備編輯專案詳細資訊 (名稱與日期)
  const handleEditProjectDetails = (project) => {
    setEditingProjectId(project.id);
    setEditingProjectName(project.name);
    setEditingProjectStartDate(project.startDate || '');
    setEditingProjectEndDate(project.endDate || '');
  };

  // 儲存修改後的專案詳細資訊
  const handleSaveProjectDetails = async (projectId) => {
    if (!editingProjectName.trim()) return;
    setIsUpdatingProject(true);
    try {
      const projectRef = doc(db, 'artifacts', globalAppId, 'public', 'data', 'projects', projectId);
      await updateDoc(projectRef, { 
        name: editingProjectName.trim(),
        startDate: editingProjectStartDate,
        endDate: editingProjectEndDate
      });
      setEditingProjectId(null);
    } catch (error) {
      console.error("更新專案資訊失敗:", error);
    } finally {
      setIsUpdatingProject(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-300">
      
      {/* ================= 區塊 1：個人化設定 ================= */}
      <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center mb-6 border-b border-slate-100 dark:border-slate-700/50 pb-4">
          <User className="mr-3 text-indigo-500" size={24} />
          個人化設定
        </h2>

        <div className="space-y-8">
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 flex items-center mb-4">
              <ImageIcon className="mr-2 text-slate-400" size={18} /> 個人圖片設定
            </h3>
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <div className="w-24 h-24 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden shadow-inner flex-shrink-0">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="預覽" className="w-full h-full object-cover" onError={(e) => e.target.src = ''} />
                ) : (
                  <User size={40} className="text-slate-300 dark:text-slate-600" />
                )}
              </div>
              <div className="flex-1 w-full">
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">圖片對外連結 (URL)</label>
                <input 
                  type="text" 
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://example.com/my-photo.jpg" 
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                  為確保系統效能，目前僅支援填入公開之網路圖片連結作為個人頭貼。
                </p>
              </div>
            </div>
          </div>

          <hr className="border-slate-100 dark:border-slate-700/50" />

          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 flex items-center mb-4">
              <Star className="mr-2 text-amber-500" size={18} /> 儀表板「我的最愛」捷徑
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">勾選您常用的功能模組，它們將會顯示在「總覽儀表板」的快速捷徑區，方便您一鍵直達。</p>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {ALL_MODULES.map(module => (
                <label key={module.id} className={`flex items-center p-4 border rounded-xl cursor-pointer transition-all ${favoriteIds.includes(module.id) ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 dark:border-indigo-400' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30'}`}>
                  <div className="relative flex items-center justify-center">
                    <input 
                      type="checkbox" 
                      className="peer sr-only"
                      checked={favoriteIds.includes(module.id)}
                      onChange={() => handleToggleFavorite(module.id)}
                    />
                    <div className="w-5 h-5 border-2 border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 peer-checked:bg-indigo-500 peer-checked:border-indigo-500 transition-all"></div>
                    <CheckCircle2 size={16} className="absolute text-white opacity-0 peer-checked:opacity-100 transition-opacity" />
                  </div>
                  <span className={`ml-3 font-bold text-sm ${favoriteIds.includes(module.id) ? 'text-indigo-800 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'}`}>
                    {module.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="pt-6 flex items-center justify-between">
            <span className={`text-sm font-bold ${saveMessage.includes('✅') ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
              {saveMessage}
            </span>
            <button 
              onClick={handleSaveSettings}
              disabled={isSaving}
              className="flex items-center px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl font-bold transition-all active:scale-95 shadow-md"
            >
              {isSaving ? <Loader2 size={18} className="animate-spin mr-2" /> : <Save size={18} className="mr-2" />}
              <span>儲存變更</span>
            </button>
          </div>

        </div>
      </div>

      {/* ================= 區塊 2：系統設定與專案管理 ================= */}
      <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm">
        <div className="mb-6 border-b border-slate-100 dark:border-slate-700/50 pb-4">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center mb-2">
            <Settings className="mr-3 text-slate-500" size={24} />
            系統管理與專案設定
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 pl-9">
            此區塊為系統管理專區。您可以在此控管各專案的存取權限、雲端歸檔目錄結構，或進行專案名稱與日期的修改、空間刪除。
          </p>
        </div>

        <div className="space-y-4">
          {projects.length === 0 ? (
            <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 border-dashed">
              <p className="text-slate-500 dark:text-slate-400 text-sm font-bold">目前系統中尚無建立任何專案</p>
            </div>
          ) : (
            projects.map(project => (
              <div key={project.id} className="flex flex-col p-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm transition-all">
                
                <div className="flex flex-col xl:flex-row xl:items-start justify-between mb-2 gap-4">
                  <div className="flex-1 pr-4">
                    {/* 專案詳細資訊編輯功能 (名稱與日期) */}
                    {editingProjectId === project.id ? (
                      <div className="flex flex-col space-y-3 bg-slate-50 dark:bg-slate-800/80 p-4 rounded-xl border border-indigo-100 dark:border-indigo-500/20">
                        <div>
                          <label className="text-[10px] text-slate-500 dark:text-slate-400 font-bold mb-1 block">專案名稱</label>
                          <input
                            type="text"
                            value={editingProjectName}
                            onChange={(e) => setEditingProjectName(e.target.value)}
                            className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                            autoFocus
                          />
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3">
                          <div className="flex-1">
                            <label className="text-[10px] text-slate-500 dark:text-slate-400 font-bold mb-1 block">計畫開始日期</label>
                            <input
                              type="date"
                              value={editingProjectStartDate}
                              onChange={(e) => setEditingProjectStartDate(e.target.value)}
                              className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] text-slate-500 dark:text-slate-400 font-bold mb-1 block">計畫結束日期</label>
                            <input
                              type="date"
                              value={editingProjectEndDate}
                              onChange={(e) => setEditingProjectEndDate(e.target.value)}
                              className="px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end space-x-2 pt-2">
                          <button
                            onClick={() => setEditingProjectId(null)}
                            className="px-3 py-1.5 bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 rounded-lg transition-colors text-xs font-bold flex items-center"
                          >
                            <X size={14} className="mr-1" /> 取消
                          </button>
                          <button
                            onClick={() => handleSaveProjectDetails(project.id)}
                            disabled={isUpdatingProject}
                            className="px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition-colors text-xs font-bold flex items-center"
                          >
                            {isUpdatingProject ? <Loader2 size={14} className="animate-spin mr-1" /> : <Check size={14} className="mr-1" />} 儲存變更
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="group">
                        <h3 className="font-bold text-slate-800 dark:text-white text-lg flex items-center">
                          {project.name}
                          <button
                            onClick={() => handleEditProjectDetails(project)}
                            className="ml-3 p-1.5 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:text-indigo-400 dark:hover:bg-indigo-500/20 rounded-md transition-all"
                            title="修改專案設定"
                          >
                            <Edit2 size={16} />
                          </button>
                        </h3>
                        <div className="flex flex-col sm:flex-row sm:items-center text-xs text-slate-500 dark:text-slate-400 mt-2 gap-2 sm:gap-4">
                          <span className="flex items-center">
                            <Calendar size={14} className="mr-1 text-slate-400" />
                            計畫區間：{project.startDate || '未設定'} ~ {project.endDate || '未設定'}
                          </span>
                          <span className="hidden sm:inline text-slate-300 dark:text-slate-600">|</span>
                          <span>建立時間：{new Date(project.createdAt).toLocaleDateString()}</span>
                          <span className="hidden sm:inline text-slate-300 dark:text-slate-600">|</span>
                          <span>專案 UID: {project.id.slice(0, 8)}...</span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* 操作按鈕區 */}
                  <div className="flex flex-wrap items-center gap-2 flex-shrink-0 mt-2 xl:mt-0">
                    <button 
                      onClick={() => handleOpenFolderSettings(project)}
                      className={`flex items-center px-3 py-2 text-sm font-bold rounded-xl transition-colors ${editingFolderProjectId === project.id ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400' : 'bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600'}`}
                    >
                      <FolderTree size={16} className="mr-1.5" /> 目錄歸檔
                    </button>
                    
                    <button className="flex items-center px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm font-bold rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors">
                      <Shield size={16} className="mr-1.5 text-indigo-500" /> 管理權限
                    </button>

                    {/* 防呆刪除確認邏輯 */}
                    {confirmDeleteId === project.id ? (
                      <div className="flex items-center space-x-2 bg-red-50 dark:bg-red-500/10 px-2 py-1.5 rounded-xl border border-red-200 dark:border-red-500/30 animate-in fade-in zoom-in-95">
                        <span className="text-xs text-red-600 dark:text-red-400 font-bold mx-2">確認刪除？</span>
                        <button 
                          onClick={() => handleDeleteProject(project.id)}
                          disabled={isDeleting === project.id}
                          className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center"
                        >
                          {isDeleting === project.id ? <Loader2 size={14} className="animate-spin mr-1" /> : '確定'}
                        </button>
                        <button 
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 bg-white dark:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 text-xs transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(project.id)}
                        className="flex items-center p-2 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        title="刪除專案"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>

                {/* 動態展開的歸檔目錄設定區塊 */}
                {editingFolderProjectId === project.id && (
                  <div className="mt-4 p-5 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-700 animate-in fade-in slide-in-from-top-2">
                    <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-2 flex items-center text-sm">
                      <FolderTree size={16} className="mr-2 text-indigo-500" />
                      設定【{project.name}】的雲端歸檔層級
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                      根目錄固定為專案名稱 <code>{project.name}</code>，您可以在下方設定後續兩層分類。<br/>
                      例如：第一層 <code>會議記錄</code> / 第二層 <code>工作週會</code>。第二層若留白則僅建置一層。
                    </p>
                    
                    <div className="space-y-3 mb-4">
                      {projectFolders.map((folder, index) => (
                        <div key={folder.id} className="flex items-center space-x-3">
                          <span className="text-slate-400 text-xs font-bold w-4 text-center">{index + 1}.</span>
                          <input 
                            type="text" 
                            placeholder="第一層目錄 (必填)" 
                            value={folder.level1}
                            onChange={(e) => handleFolderChange(folder.id, 'level1', e.target.value)}
                            className="flex-1 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
                          />
                          <span className="text-slate-400">/</span>
                          <input 
                            type="text" 
                            placeholder="第二層目錄 (選填)" 
                            value={folder.level2}
                            onChange={(e) => handleFolderChange(folder.id, 'level2', e.target.value)}
                            className="flex-1 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
                          />
                          <button 
                            onClick={() => handleRemoveFolderRow(folder.id)}
                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 pt-4 mt-2">
                      <button 
                        onClick={handleAddFolderRow}
                        className="flex items-center text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        <Plus size={14} className="mr-1" /> 新增目錄規則
                      </button>
                      <div className="flex items-center space-x-2">
                        <button 
                          onClick={() => setEditingFolderProjectId(null)}
                          className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        >
                          取消
                        </button>
                        <button 
                          onClick={() => handleSaveFolders(project.id)}
                          disabled={isSavingFolders}
                          className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-xs font-bold rounded-lg transition-all"
                        >
                          {isSavingFolders ? <Loader2 size={14} className="animate-spin mr-1" /> : <Save size={14} className="mr-1" />}
                          儲存目錄設定
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      
    </div>
  );
}
