import React, { useState, useEffect } from 'react';
import { X, CalendarDays, Settings, Check, RefreshCw } from 'lucide-react';
import { doc, getDoc, setDoc, getFirestore } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const db = getFirestore(getApp());

export default function WorkCalendarSettingsModal({ isOpen, onClose, selectedProject }) {
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1); // 1-12
  const [offDays, setOffDays] = useState({}); // 格式: { "2026-06-01": true } 代表放假

  // 讀取該專案的行事曆設定
  useEffect(() => {
    if (!isOpen || !selectedProject) return;
    const fetchCalendar = async () => {
      try {
        const docRef = doc(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'calendars', selectedProject);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setOffDays(docSnap.data().offDays || {});
        }
      } catch (e) {
        console.error("讀取專案日曆失敗:", e);
      }
    };
    fetchCalendar();
  }, [isOpen, selectedProject]);

  if (!isOpen) return null;

  // 儲存至 Firestore
  const handleSaveCalendar = async (updatedOffDays) => {
    try {
      const docRef = doc(db, 'artifacts', 'gov-project-saas', 'public', 'data', 'calendars', selectedProject);
      
      // 💡 【核心優化點】拿掉原本具有攔截盲點的 { merge: true }，直接整包覆寫 offDays 欄位
      // 這樣一來，被 delete 清除掉的日期 Key 才會在 Firestore 雲端資料庫中同步徹底消失釋放！
      await setDoc(docRef, { 
        offDays: updatedOffDays, 
        updatedAt: new Date().getTime() 
      });
      
      setOffDays(updatedOffDays);
    } catch (e) {
      console.error("儲存專案日曆失敗:", e);
    }
  };

  // 切換單一日期的狀態
  const toggleDay = (dateStr) => {
    const updated = { ...offDays };
    if (updated[dateStr]) {
      delete updated[dateStr];
    } else {
      updated[dateStr] = true;
    }
    handleSaveCalendar(updated);
  };

  // 一鍵初始化當月的週六、週日為休假日
  const handleInitWeekend = () => {
    const updated = { ...offDays };
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(currentYear, currentMonth - 1, d);
      const dayOfWeek = date.getDay(); // 0 是週日, 6 是週六
      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        updated[dateStr] = true;
      }
    }
    handleSaveCalendar(updated);
  };

  // 生成當月行事曆網格
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const firstDayIndex = new Date(currentYear, currentMonth - 1, 1).getDay();
  
  const calendarCells = [];
  // 補足前段空白
  for (let i = 0; i < firstDayIndex; i++) {
    calendarCells.push(<div key={`empty-${i}`} className="p-3"></div>);
  }
  // 填入當月日期
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isOff = !!offDays[dateStr];
    
    calendarCells.push(
      <button
        key={`day-${d}`}
        type="button"
        onClick={() => toggleDay(dateStr)}
        className={`p-3 rounded-xl border flex flex-col items-center justify-between h-14 text-xs font-bold transition-all ${
          isOff 
            ? 'bg-red-50 border-red-200 text-red-600 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400' 
            : 'bg-white border-slate-100 text-slate-800 hover:border-indigo-400 dark:bg-slate-800 dark:border-slate-700 dark:text-white'
        }`}
      >
        <span>{d}</span>
        <span className={`text-[9px] px-1 rounded ${isOff ? 'bg-red-200/60 dark:bg-red-900/60' : 'text-emerald-500'}`}>
          {isOff ? '放假/非上班' : '應上班'}
        </span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white dark:bg-slate-800 w-full max-w-xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/80">
          <div className="flex items-center space-x-2">
            <CalendarDays size={20} className="text-indigo-500" />
            <h3 className="font-bold text-lg text-slate-800 dark:text-white">定義計畫行事曆工作日</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-4 bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <select value={currentYear} onChange={e => setCurrentYear(Number(e.target.value))} className="text-xs font-bold p-1.5 rounded-lg border dark:bg-slate-800 dark:border-slate-700">
              {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y} 年</option>)}
            </select>
            <select value={currentMonth} onChange={e => setCurrentMonth(Number(e.target.value))} className="text-xs font-bold p-1.5 rounded-lg border dark:bg-slate-800 dark:border-slate-700">
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m} 月</option>)}
            </select>
          </div>
          <button 
            type="button"
            onClick={handleInitWeekend}
            className="flex items-center space-x-1 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 rounded-lg text-xs font-bold border border-indigo-200 dark:border-indigo-500/30 transition-colors"
          >
            <RefreshCw size={12} />
            <span>一鍵初始化常態週六日為例假日</span>
          </button>
        </div>

        {/* Calendar Grid */}
        <div className="p-6 overflow-y-auto flex-1">
          <div className="grid grid-cols-7 gap-2 text-center text-[10px] font-bold text-slate-400 uppercase mb-2">
            {['日', '一', '二', '三', '四', '五', '六'].map(w => <div key={w}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {calendarCells}
          </div>
          <p className="text-[10px] text-slate-400 mt-4 leading-relaxed">
            * 點擊日期可直接切換「應上班日」與「放假/非上班日」。<br />
            * 考勤系統在進行數據核對時，會自動排除放假日，只計罰應上班日未正常刷卡且無規政代理文件的天數。
          </p>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm flex items-center">
            <Check size={16} className="mr-1.5" />完成設定
          </button>
        </div>
      </div>
    </div>
  );
}
