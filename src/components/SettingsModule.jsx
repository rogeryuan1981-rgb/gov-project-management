import React, { useState } from 'react';
import { User, Image as ImageIcon, Star, Save, CheckCircle2, Loader2 } from 'lucide-react';
import { updateProfile } from 'firebase/auth';

export default function SettingsModule({ user, favoriteIds, setFavoriteIds }) {
  // 將 Firebase 中儲存的 photoURL 放入 input state
  const [avatarUrl, setAvatarUrl] = useState(user?.photoURL || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // 系統功能模組常數，用於渲染勾選清單 (非假資料)
  const ALL_MODULES = [
    { id: 'tasks', label: '工項與進度追蹤' },
    { id: 'hr', label: '人事合規紀錄' },
    { id: 'archive', label: '雲端歸檔空間' },
    { id: 'reimbursement', label: '核銷作業專區' },
  ];

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

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-300">
      
      <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-3xl border border-slate-200 dark:border-slate-700/80 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center mb-6 border-b border-slate-100 dark:border-slate-700/50 pb-4">
          <User className="mr-3 text-indigo-500" size={24} />
          個人化設定
        </h2>

        <div className="space-y-8">
          {/* 大頭貼設定 */}
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

          {/* 我的最愛設定 */}
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
    </div>
  );
}
