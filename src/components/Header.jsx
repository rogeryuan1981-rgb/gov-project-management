import React, { useState } from 'react';
import { Sun, Moon, Bell, LogOut, ChevronDown, Users, ArrowLeft } from 'lucide-react';
import { signInAnonymously, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';

export default function Header({ darkMode, setDarkMode, user, selectedTask, setSelectedTask, activeTab }) {
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      setIsUserDropdownOpen(false);
    } catch (error) {
      console.error("Google Login Error:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setIsUserDropdownOpen(false);
      await signInAnonymously(auth); // 保持訪客身分以確保 UI 正常
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  const getPageTitle = () => {
    if (selectedTask) return '工項詳細資料';
    switch(activeTab) {
      case 'dashboard': return '總覽儀表板';
      case 'tasks': return '工項與進度追蹤';
      case 'hr': return '人事合規與代理紀錄';
      case 'archive': return 'Google Drive 雲端歸檔空間';
      case 'reimbursement': return '核銷作業與報表中心';
      default: return '標案管理系統';
    }
  };

  return (
    <header className="h-16 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-8 sticky top-0 z-10 transition-colors">
      <h1 className="text-xl font-bold text-slate-800 dark:text-white flex items-center">
        {selectedTask && (
          <button onClick={() => setSelectedTask(null)} className="mr-3 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors">
            <ArrowLeft size={20} />
          </button>
        )}
        <span>{getPageTitle()}</span>
      </h1>
      
      <div className="flex items-center space-x-4">
        <button className="p-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 relative">
          <Bell size={20} />
          <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white dark:border-slate-800"></span>
        </button>
        
        <button onClick={() => setDarkMode(!darkMode)} className="p-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">
          {darkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>

        <div className="h-8 w-px bg-slate-200 dark:bg-slate-700 mx-2"></div>

        <div className="relative">
          <div className="flex items-center space-x-3 cursor-pointer group" onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}>
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold shadow-sm overflow-hidden">
              {user && !user.isAnonymous && user.photoURL ? <img src={user.photoURL} alt="avatar" className="w-full h-full object-cover" /> : "管"}
            </div>
            <div className="hidden md:block text-left">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {user && !user.isAnonymous ? user.displayName : '訪客 / 匿名使用者'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {user && !user.isAnonymous ? user.email : (user ? `已連線 (${user.uid.slice(0, 6)})` : '連線中...')}
              </p>
            </div>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${isUserDropdownOpen ? 'rotate-180' : ''}`} />
          </div>

          {isUserDropdownOpen && (
            <div className="absolute right-0 mt-3 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-50 py-1">
              {user && !user.isAnonymous ? (
                <button onClick={handleLogout} className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center font-medium">
                  <LogOut size={16} className="mr-2" /> 登出系統
                </button>
              ) : (
                <button onClick={handleGoogleLogin} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center font-medium">
                  <Users size={16} className="mr-2 text-indigo-500" /> 使用 Google 登入
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
