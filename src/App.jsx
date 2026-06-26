import React, { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import VOCAB from "./vocab.js";
import READING_DATA from "./reading.js";


const STAGES = [1, 3, 7, 14, 30];
const DAY_MS = 24 * 60 * 60 * 1000;

// ─── 工具函数 ─────────────────────────────────────────────────────────────
function todayKey() { return new Date().toDateString(); }
function addDays(ts, d) { return ts + d * DAY_MS; }

const POS_MAP = {
  "명사": "名词", "동사": "动词", "형용사": "形容词", "부사": "副词",
  "조사": "助词", "접속사": "接续词", "감탄사": "感叹词", "수사": "数词",
  "관형사": "冠形词", "의존명사": "依存名词", "보조동사": "补助动词",
  "보조형용사": "补助形容词",
};
function posLabel(pos) {
  if (!pos) return "";
  return pos.split("/").map(p => POS_MAP[p.trim()] || p.trim()).join(" / ");
}

// 从progress派生某天的日历状态，不依赖独立calendar存储
// "full"=学+测验都做了  "new"=只学了词  "today"=今天还没开始  "none"=空
function getDayState(dateStr, progress, dailyGoal) {
  const isToday = dateStr === todayKey();
  const wordsLearned = VOCAB.filter(v => progress[v.id]?.learnedDate === dateStr);
  if (wordsLearned.length === 0) return isToday ? "today" : "none";
  // 达到当日目标才算"学完"
  const reachedGoal = wordsLearned.length >= dailyGoal;
  // 有任何词stage已推进（做过测验被处理）或已mastered
  const anyReviewed = wordsLearned.some(v => {
    const p = progress[v.id];
    return p && ((p.stage ?? -1) > -1 || p.status === "mastered");
  });
  if (anyReviewed) return "full";
  if (reachedGoal || wordsLearned.length > 0) return "new";
  return isToday ? "today" : "none";
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function quizWord(w) { return w.replace(/\([^)]*\)/g, "").trim(); }
function renderBold(text) {
  return String(text || "").split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} className="text-indigo-600 font-bold">{p.slice(2,-2)}</strong>
      : <React.Fragment key={i}>{p}</React.Fragment>
  );
}

// ─── 声音反馈 ─────────────────────────────────────────────────────────────
function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (type === "correct") {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1100, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(); osc.stop(ctx.currentTime + 0.25);
    } else if (type === "neutral") {
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(); osc.stop(ctx.currentTime + 0.12);
    } else {
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(); osc.stop(ctx.currentTime + 0.4);
    }
  } catch(e) {}
}
function vibrate(type) {
  if (!navigator.vibrate) return;
  if (type === "correct") navigator.vibrate(80);
  else navigator.vibrate(1000);
}

// ─── API 例句 ──────────────────────────────────────────────────────────────
async function generateExample(word, meaning) {
  let userKey = "", userProvider = "anthropic";
  try {
    userKey = localStorage.getItem("topik_user_api_key") || "";
    userProvider = localStorage.getItem("topik_user_api_provider") || "anthropic";
  } catch(e) {}
  const headers = { "Content-Type": "application/json" };
  if (userKey) { headers["x-user-api-key"] = userKey; headers["x-user-api-provider"] = userProvider; }
  const res = await fetch("/api/example", { method:"POST", headers, body: JSON.stringify({ word, meaning }) });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || `请求失败（${res.status}）`); }
  const data = await res.json();
  return { sentence: data.sentence || "（生成失败，请重试）", translation: data.translation || "", placeholder: false };
}

// ─── 图标 SVG ─────────────────────────────────────────────────────────────
const Icons = {
  home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>,
  study: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  quiz: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  progress: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="20 6 9 17 4 12"/></svg>,
  star: "⭐", flame: "🔥", leaf: "🌱",
};

// ─── 日历完成徽章 ─────────────────────────────────────────────────────────
function DayBadge({ state }) {
  if (state === "full") return <span className="w-8 h-8 rounded-full bg-[#93C85F] border-2 border-[#1E1C18] flex items-center justify-center text-white">{Icons.check}</span>;
  if (state === "new") return <span className="w-8 h-8 rounded-full bg-[#6D5DF6] flex items-center justify-center"></span>;
  if (state === "today") return <span className="w-8 h-8 rounded-full border-2 border-[#6D5DF6] flex items-center justify-center"></span>;
  return <span className="w-8 h-8 rounded-full flex items-center justify-center"></span>;
}

// ─── 完成庆祝动画 ────────────────────────────────────────────────────────
function CelebrationOverlay({ stats, onClose }) {
  const emojis = ["⭐","✅","🔥","🌱","⭐","✅"];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(246,240,228,0.92)", backdropFilter: "blur(8px)" }}>
      <div className="relative">
        {emojis.map((e,i) => (
          <span key={i} className="absolute text-2xl pointer-events-none"
            style={{
              left: `${(i%3-1)*80 + Math.random()*40}px`,
              top: `${-120 - i*30}px`,
              animation: `floatUp ${1.6+i*0.2}s ease-out forwards`,
              animationDelay: `${i*0.1}s`,
              opacity: 0,
            }}>{e}</span>
        ))}
        <div className="bg-[#FFFDF7] border-2 border-[#1E1C18] rounded-[36px] shadow-[0_8px_0_#1E1C18] p-9 max-w-sm w-full text-center mx-4">
          <div className="text-4xl mb-3">🔥</div>
          <h2 className="font-bold text-xl mb-1" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>오늘의 학습 완료!</h2>
          <p className="text-sm text-[#686157] mb-5">멋져요! 꾸준함이 힘이 됩니다.</p>
          <div className="flex justify-center gap-6 mb-6">
            <div className="text-center">
              <div className="text-2xl font-bold" style={{ fontFamily: "Georgia, serif" }}>{stats.learned}</div>
              <div className="text-xs text-[#686157]">학습 단어</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-[#93C85F]" style={{ fontFamily: "Georgia, serif" }}>{stats.accuracy}%</div>
              <div className="text-xs text-[#686157]">정답률</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-[#6D5DF6]" style={{ fontFamily: "Georgia, serif" }}>{stats.streak}</div>
              <div className="text-xs text-[#686157]">연속 학습</div>
            </div>
          </div>
          <button onClick={onClose} className="w-full py-3 rounded-[24px] bg-[#6D5DF6] text-white font-bold border-2 border-[#1E1C18] shadow-[0_5px_0_#1E1C18] active:translate-y-1 active:shadow-[0_1px_0_#1E1C18] transition-all">
            계속하기
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── 首页 ─────────────────────────────────────────────────────────────────
function HomePage({ progress, dailyCount, streak, examDate, dailyGoal }) {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const weekDays = ["日","一","二","三","四","五","六"];

  // 学习计划计算
  const planInfo = useMemo(() => {
    const untouched = VOCAB.filter(v => !progress[v.id]).length;
    const daysToFinish = Math.ceil(untouched / dailyGoal);
    if (!examDate) return { untouched, daysToFinish, daysLeft: null, slack: null, suggestDaily: null };
    const exam = new Date(examDate);
    exam.setHours(0,0,0,0);
    const today = new Date(); today.setHours(0,0,0,0);
    const daysLeft = Math.ceil((exam - today) / (1000 * 60 * 60 * 24));
    const slack = daysLeft - daysToFinish;
    const suggestDaily = daysLeft > 0 ? Math.ceil(untouched / daysLeft) : null;
    return { untouched, daysToFinish, daysLeft, slack, suggestDaily };
  }, [progress, examDate]);

  return (
    <div className="space-y-4">
      {/* Streak 卡片 */}
      <div className="rounded-[28px] p-5 border border-[rgba(30,28,24,0.16)] bg-[#FFF8EC]">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🔥</span>
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold" style={{ fontFamily:"Georgia, serif" }}>{streak}</span>
              <span className="text-sm text-[#686157]">day streak</span>
            </div>
            <p className="text-xs text-[#8A8174]">Keep it glowing!</p>
          </div>
        </div>
      </div>

      {/* 考试倒计时 + 学习计划 */}
      {examDate && planInfo.daysLeft !== null && (
        <div className={`rounded-[22px] p-4 border ${planInfo.slack < 0 ? "bg-[#FFE5DF] border-[#C94B3C]" : planInfo.slack <= 7 ? "bg-[#FFF4C8] border-[#F8C94A]" : "bg-[#EAF6DC] border-[#93C85F]"}`}>
          <div className="flex justify-between items-start mb-2">
            <div>
              <p className="text-xs text-[#686157] mb-0.5">距离考试</p>
              <p className="text-2xl font-bold" style={{ fontFamily:"Georgia,serif" }}>
                {planInfo.daysLeft > 0 ? `${planInfo.daysLeft} 天` : "今天考试！"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[#686157] mb-0.5">剩余未学</p>
              <p className="text-2xl font-bold" style={{ fontFamily:"Georgia,serif" }}>{planInfo.untouched} 词</p>
            </div>
          </div>
          <div className="h-px bg-[rgba(30,28,24,0.1)] my-2"/>
          {planInfo.slack >= 0 ? (
            <div className="space-y-1 text-sm">
              <p>按每天{dailyGoal}个，还需 <strong>{planInfo.daysToFinish} 天</strong>背完</p>
              <p className="text-[#686157]">
                {planInfo.slack === 0
                  ? "⚡ 刚好来得及，不能再拖了"
                  : `😌 你还有 ${planInfo.slack} 天可以摸鱼`}
              </p>
              {planInfo.suggestDaily && planInfo.suggestDaily !== 36 && (
                <p className="text-xs text-[#8A8174]">若想考前刚好背完，建议每天背 <strong>{planInfo.suggestDaily} 个</strong></p>
              )}
            </div>
          ) : (
            <div className="space-y-1 text-sm">
              <p className="text-[#C94B3C] font-bold">⚠️ 按当前进度考试前背不完</p>
              <p className="text-[#686157]">建议每天至少背 <strong>{planInfo.suggestDaily} 个</strong>才能覆盖全部词汇</p>
            </div>
          )}
        </div>
      )}

      {/* 日历 */}
      <div className="rounded-[32px] bg-[#FFFDF7] border-2 border-[#1E1C18] shadow-[0_6px_0_#1E1C18] p-5">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-bold text-sm">{year}年{month+1}月</h3>
        </div>
        <div className="grid grid-cols-7 gap-1 mb-2">
          {weekDays.map(d => <div key={d} className="text-center text-xs text-[#8A8174]">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({length: firstDay}).map((_,i) => <div key={`e${i}`}/>)}
          {Array.from({length: daysInMonth}).map((_,i) => {
            const d = i+1;
            const key = new Date(year, month, d).toDateString();
            const isToday = key === todayKey();
            const state = getDayState(key, progress, dailyGoal);
            return (
              <div key={d} className="flex flex-col items-center py-0.5">
                <DayBadge state={state}/>
                <span className={`text-xs mt-0.5 ${isToday ? "text-[#6D5DF6] font-bold" : "text-[#686157]"}`}>{d}</span>
              </div>
            );
          })}
        </div>
        <p className="text-center text-xs text-[#8A8174] mt-3">Build a streak, one day at a time</p>
      </div>

      {/* 今日目标 */}
      <div className="rounded-[22px] bg-[#FFFDF7] border border-[rgba(30,28,24,0.16)] p-5 shadow-[0_8px_20px_rgba(30,28,24,0.10)]">
        <p className="text-sm font-bold mb-3">今日目标</p>
        {(() => {
          const used = dailyCount.date === todayKey() ? dailyCount.used : 0;
          const pct = Math.min(100, Math.round((used / dailyGoal) * 100));
          const learned = Object.values(progress).filter(p => p.status==="learning"||p.status==="mastered").length;
          return (
            <>
              <p className="text-xs text-[#686157] mb-1">학습 단어 {used} / {dailyGoal}</p>
              <div className="h-2.5 bg-[#E7DDCE] rounded-full overflow-hidden mb-3">
                <div className="h-full bg-[#6D5DF6] rounded-full transition-all" style={{ width: `${pct}%` }}/>
              </div>
              <div className="flex justify-between text-xs text-[#686157]">
                <span>总词汇：{Object.keys(VOCAB).length}条</span>
                <span>已学：{learned}词</span>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ─── 学习页 ───────────────────────────────────────────────────────────────
function StudyPage({ progress, dailyCount, setProgress, setDailyCount, onComplete, dailyGoal }) {
  const [learnHistory, setLearnHistory] = useState([]);
  const [exampleCache, setExampleCache] = useState({});
  const [loadingExample, setLoadingExample] = useState(false);
  const [feedback, setFeedback] = useState(null); // "seen"|"unseen"|"master"

  const now = Date.now();

  const newWords = useMemo(() => {
    const used = dailyCount.date === todayKey() ? dailyCount.used : 0;
    const remaining = Math.max(0, dailyGoal - used);
    return VOCAB.filter(v => !progress[v.id]).slice(0, remaining);
  }, [progress, dailyCount]);

  const currentWord = newWords[0];

  async function loadExample(word) {
    if (exampleCache[word.id] || loadingExample) return;
    setLoadingExample(true);
    try {
      const r = await generateExample(word.word, word.meaning);
      setExampleCache(p => ({ ...p, [word.id]: r }));
    } catch(e) {
      setExampleCache(p => ({ ...p, [word.id]: { sentence: `生成失败：${e.message}`, translation: "", placeholder: true } }));
    } finally { setLoadingExample(false); }
  }

  function markLearn(word, action) {
    const today = todayKey();
    // 当天0点时间戳，确保今天学的词今天就可以复习，不受学习时刻影响
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const reviewFrom = todayStart.getTime();
    if (action === "master") playSound("correct");
    else playSound("neutral");
    setDailyCount(prev => {
      const used = prev.date === today ? prev.used : 0;
      return { date: today, used: used + 1 };
    });
    setProgress(prev => {
      const next = { ...prev };
      next[word.id] = action === "master"
        ? { status:"learning", stage:-1, nextReview:reviewFrom, guessRecent:false, learnedDate:today, learnAction:"master" }
        : { status:"learning", stage:-1, nextReview:reviewFrom, guessRecent:false, learnedDate:today, learnAction:action };
      return next;
    });
    setLearnHistory(h => [...h, word.id]);
    setFeedback(action);
    setTimeout(() => setFeedback(null), 300);
    // 检查今日是否完成
    setTimeout(() => {
      const used2 = (dailyCount.date === today ? dailyCount.used : 0) + 1;
      if (used2 >= dailyGoal) {
        onComplete && onComplete();
      }
    }, 100);
  }

  function goPrev() {
    if (!learnHistory.length) return;
    const lastId = learnHistory[learnHistory.length-1];
    setProgress(prev => { const next={...prev}; delete next[lastId]; return next; });
    setDailyCount(prev => {
      const today = todayKey();
      const used = Math.max(0, (prev.date===today ? prev.used : 0) - 1);
      return { date: today, used };
    });
    setLearnHistory(h => h.slice(0,-1));
  }

  if (newWords.length === 0 && !currentWord) {
    const totalUntouched = VOCAB.filter(v => !progress[v.id]).length;
    return (
      <div className="rounded-[32px] bg-[#FFFDF7] border-2 border-[#1E1C18] shadow-[0_7px_0_#1E1C18] p-10 text-center">
        <div className="text-4xl mb-4">✅</div>
        <h3 className="font-bold text-lg mb-2" style={{ fontFamily:"'Noto Sans KR',sans-serif" }}>오늘 학습 완료!</h3>
        <p className="text-sm text-[#686157] mb-6">去「测验」页巩固今日单词吧</p>
        {totalUntouched > 0 && (
          <button
            onClick={() => {
              const today = todayKey();
              setDailyCount(prev => ({
                date: today,
                used: Math.max(0, (prev.date === today ? prev.used : 0) - dailyGoal),
              }));
            }}
            className="w-full py-3 rounded-[24px] border-2 border-[#1E1C18] bg-[#EAE7FF] text-[#4B3BC8] font-bold shadow-[0_4px_0_#1E1C18] active:translate-y-1 active:shadow-[0_1px_0_#1E1C18] transition-all text-sm">
            再学一天的单词（剩余 {totalUntouched} 词）
          </button>
        )}
        {totalUntouched === 0 && (
          <p className="text-xs text-[#93C85F] font-bold">🎉 词库已全部学完！</p>
        )}
      </div>
    );
  }

  const used = dailyCount.date === todayKey() ? dailyCount.used : 0;

  return (
    <div className="space-y-4">
      {/* 进度行 */}
      <div className="flex items-center gap-3">
        <button onClick={goPrev} disabled={!learnHistory.length}
          className="w-10 h-10 rounded-[12px] bg-[#FFFDF7] border-2 border-[#1E1C18] shadow-[0_3px_0_#1E1C18] flex items-center justify-center text-sm font-bold disabled:opacity-30 active:translate-y-0.5 active:shadow-[0_1px_0_#1E1C18]">‹</button>
        <div className="flex-1 h-2.5 bg-[#E7DDCE] rounded-full overflow-hidden">
          <div className="h-full bg-[#6D5DF6] rounded-full transition-all" style={{ width:`${Math.min(100,(used/36)*100)}%` }}/>
        </div>
        <span className="text-xs text-[#686157] font-bold" style={{ fontFamily:"Georgia,serif" }}>{used}/36</span>
      </div>

      {/* 单词卡 */}
      {currentWord && (
        <div className={`rounded-[36px] bg-[#FFFDF7] border-2 border-[#1E1C18] shadow-[0_7px_0_#1E1C18] p-8 text-center transition-all ${feedback ? "scale-[0.98]" : ""}`}>
          {/* 词性标签 */}
          <div className="flex justify-center mb-4">
            <span className="px-4 py-1.5 rounded-full bg-[#6D5DF6] text-white text-sm font-bold">{posLabel(currentWord.pos)}</span>
          </div>
          {/* 韩语大字 */}
          <div className="text-5xl font-black mb-4 leading-tight tracking-tight" style={{ fontFamily:"'Noto Sans KR',sans-serif" }}>
            {quizWord(currentWord.word)}
          </div>
          {/* 中文释义 */}
          <div className="text-xl font-medium mb-6 text-[#181713]">{currentWord.meaning}</div>
          {/* 例句 */}
          <div className="rounded-[20px] bg-[#F6F0E4] p-4 min-h-[80px] mb-2 text-left flex items-center justify-center">
            {exampleCache[currentWord.id] ? (
              exampleCache[currentWord.id].placeholder ? (
                <p className="text-sm text-[#8A8174] w-full">{exampleCache[currentWord.id].sentence}</p>
              ) : (
                <div className="w-full">
                  <p className="text-sm mb-1 leading-relaxed">{renderBold(exampleCache[currentWord.id].sentence)}</p>
                  <p className="text-xs text-[#686157]">{exampleCache[currentWord.id].translation}</p>
                </div>
              )
            ) : (
              <button onClick={() => loadExample(currentWord)} disabled={loadingExample}
                style={{ boxShadow: "0 4px 0 #1E1C18" }}
                className="flex items-center gap-2 bg-[#6D5DF6] border-2 border-[#1E1C18] rounded-[999px] px-6 py-2.5 active:translate-y-1 transition-all">
                <span className="text-lg">✨</span>
                <span className="text-base font-bold text-white">{loadingExample ? "生成中…" : "生成例句"}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      {currentWord && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label:"没见过", action:"unseen", cls:"bg-[#FFFDF7]" },
            { label:"见过", action:"seen", cls:"bg-[#EAE7FF]" },
            { label:"已掌握", action:"master", cls:"bg-[#EAF6DC]" },
          ].map(({ label, action, cls }) => (
            <button key={action} onClick={() => markLearn(currentWord, action)}
              className={`${cls} border-2 border-[#1E1C18] rounded-[24px] shadow-[0_5px_0_#1E1C18] py-3 font-bold text-sm text-[#181713] active:translate-y-1 active:shadow-[0_1px_0_#1E1C18] transition-all`}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 测验页 ───────────────────────────────────────────────────────────────
function QuizPage({ progress, setProgress }) {
  const now = Date.now();

  const dueWords = useMemo(() => {
    const today = todayKey();
    return VOCAB.filter(v => {
      const p = progress[v.id];
      if (!p || p.status !== "learning") return false;
      // 已掌握标记的词：当天学的才进队列（当天拼写测验）
      if (p.learnAction === "master") return p.learnedDate === today;
      // 其他词：nextReview到期
      return p.nextReview && p.nextReview <= now;
    });
  }, [progress]);

  const [quizQueue, setQuizQueue] = useState(null);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizMode, setQuizMode] = useState(null);
  const [quizOptions, setQuizOptions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [animClass, setAnimClass] = useState("");
  const inputRef = useRef(null);

  function startQuiz() {
    const q = shuffle(dueWords);
    setQuizQueue(q);
    setQuizIndex(0);
    setSessionCorrect(0);
    setSessionTotal(0);
    setupItem(q, 0);
  }

  function setupItem(queue, idx) {
    if (idx >= queue.length) { setQuizQueue(null); return; }
    const word = queue[idx];
    const p = progress[word.id];
    // 出题模式：已掌握/见过→强制拼写；没见过→选择题
    const mode = (p?.learnAction === "master" || p?.learnAction === "seen") ? "input" : "choice";
    setQuizMode(mode);
    setSelected(null); setAnswered(false); setInputVal(""); setAnimClass("");
    if (mode === "choice") {
      const wrongs = shuffle(VOCAB.filter(v => v.id !== word.id)).slice(0,3).map(v => v.meaning);
      setQuizOptions(shuffle([word.meaning, ...wrongs]));
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  function checkAnswer(answer) {
    if (answered) return;
    const word = quizQueue[quizIndex];
    const correct = quizWord(word.word);
    const altCorrect = word.alt ? quizWord(word.alt) : "";
    const isCorrect = quizMode === "choice"
      ? answer === word.meaning
      : answer.trim() === correct || (altCorrect && answer.trim() === altCorrect);
    setAnswered(true);
    setSelected(answer);
    setSessionTotal(t => t+1);
    if (isCorrect) {
      setSessionCorrect(c => c+1);
      setAnimClass("animate-correct");
      playSound("correct"); vibrate("correct");
    } else {
      setAnimClass("animate-wrong");
      playSound("wrong"); vibrate("wrong");
    }
    recordAnswer(word, isCorrect);
  }

  function recordAnswer(word, correct) {
    setProgress(prev => {
      const p = prev[word.id] || { status:"learning", stage:-1, nextReview:now, guessRecent:false };
      let next;
      if (p.learnAction === "master") {
        if (correct) {
          next = { ...p, status:"mastered", stage:-1, nextReview:null, guessRecent:false };
        } else {
          next = { ...p, learnAction:"seen", stage:0, nextReview:addDays(now, STAGES[0]), guessRecent:false };
        }
      } else if (p.guessRecent && correct) {
        next = { ...p, guessRecent:false, nextReview:addDays(now, STAGES[Math.max(0, p.stage)]) };
      } else if (correct) {
        const newStage = Math.min(p.stage+1, STAGES.length-1);
        next = { ...p, stage:newStage, nextReview:addDays(now, STAGES[newStage]), guessRecent:false };
        if (newStage === STAGES.length-1) next.status = "mastered";
      } else {
        next = { ...p, stage:0, nextReview:addDays(now, STAGES[0]), guessRecent:false };
      }
      return { ...prev, [word.id]: next };
    });
  }

  function nextItem() {
    const nextIdx = quizIndex+1;
    setQuizIndex(nextIdx);
    setupItem(quizQueue, nextIdx);
  }

  function markGuess() {
    const word = quizQueue[quizIndex];
    setProgress(prev => ({ ...prev, [word.id]: { ...prev[word.id], guessRecent:true, nextReview:addDays(now,2) } }));
    nextItem();
  }

  if (!quizQueue) {
    return (
      <div className="rounded-[32px] bg-[#FFFDF7] border-2 border-[#1E1C18] shadow-[0_7px_0_#1E1C18] p-8 text-center">
        <div className="text-4xl mb-4">📝</div>
        <p className="font-bold text-lg mb-2">待复习词汇：<span className="text-[#6D5DF6]">{dueWords.length}</span> 个</p>
        {dueWords.length > 0 ? (
          <button onClick={startQuiz} className="w-full py-3 mt-4 rounded-[24px] bg-[#6D5DF6] text-white font-bold border-2 border-[#1E1C18] shadow-[0_5px_0_#1E1C18] active:translate-y-1 active:shadow-[0_1px_0_#1E1C18] transition-all">
            开始测验
          </button>
        ) : (
          <p className="text-sm text-[#686157] mt-2">今日复习已全部完成 ✅</p>
        )}
      </div>
    );
  }

  if (quizIndex >= quizQueue.length) {
    const pct = sessionTotal ? Math.round((sessionCorrect/sessionTotal)*100) : 0;
    return (
      <div className="rounded-[32px] bg-[#FFFDF7] border-2 border-[#1E1C18] shadow-[0_7px_0_#1E1C18] p-8 text-center">
        <div className="text-4xl mb-3">🎉</div>
        <h3 className="font-bold text-lg mb-1">本轮完成！</h3>
        <p className="text-3xl font-bold text-[#6D5DF6] mb-4" style={{ fontFamily:"Georgia,serif" }}>{pct}%</p>
        <p className="text-sm text-[#686157] mb-6">{sessionCorrect} / {sessionTotal} 正确</p>
        <button onClick={() => setQuizQueue(null)} className="w-full py-3 rounded-[24px] bg-[#6D5DF6] text-white font-bold border-2 border-[#1E1C18] shadow-[0_5px_0_#1E1C18] active:translate-y-1 active:shadow-[0_1px_0_#1E1C18] transition-all">
          返回
        </button>
      </div>
    );
  }

  const word = quizQueue[quizIndex];
  const pct = Math.round((quizIndex/quizQueue.length)*100);

  return (
    <div className="space-y-4">
      {/* 进度条 */}
      <div className="flex items-center gap-3">
        <button onClick={() => setQuizQueue(null)} className="text-[#686157] text-lg font-bold">✕</button>
        <div className="flex-1 h-2.5 bg-[#E7DDCE] rounded-full overflow-hidden">
          <div className="h-full bg-[#6D5DF6] rounded-full transition-all" style={{ width:`${pct}%` }}/>
        </div>
        <span className="text-xs text-[#686157]" style={{ fontFamily:"Georgia,serif" }}>{quizIndex}/{quizQueue.length}</span>
      </div>

      {/* 题目卡 */}
      <div className="rounded-[32px] bg-[#FFFDF7] border-2 border-[#1E1C18] shadow-[0_7px_0_#1E1C18] p-6 text-center">
        <p className="text-xs text-[#8A8174] mb-2 font-bold">
          {quizMode === "choice" ? "다음 뜻에 맞는 단어는?" : "다음을 한국어로 쓰시오"}
          {progress[word.id]?.learnAction === "master" && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-[#EAE7FF] text-[#4B3BC8] text-xs">✦ 掌握验证</span>
          )}
        </p>
        {quizMode === "choice" ? (
          <div className="text-4xl font-black py-6 leading-tight" style={{ fontFamily:"'Noto Sans KR',sans-serif" }}>
            {quizWord(word.word)}
          </div>
        ) : (
          <div className="py-6">
            <div className="flex justify-center mb-3">
              <span className="px-3 py-1 rounded-full bg-[#EAE7FF] text-[#4B3BC8] text-xs font-bold">{posLabel(word.pos)}</span>
            </div>
            <div className="text-xl font-medium">{word.meaning}</div>
          </div>
        )}
      </div>

      {/* 选项 / 输入 */}
      {quizMode === "choice" ? (
        <div className="grid grid-cols-2 gap-3">
          {quizOptions.map((opt, i) => {
            const isCorrect = answered && opt === word.meaning;
            const isWrong = answered && selected === opt && opt !== word.meaning;
            return (
              <button key={i} onClick={() => checkAnswer(opt)} disabled={answered}
                className={`border-2 rounded-[24px] shadow-[0_5px_0_#1E1C18] min-h-[76px] px-4 py-3 font-bold text-sm text-left transition-all active:translate-y-1 active:shadow-[0_1px_0_#1E1C18] ${animClass && (isCorrect||isWrong) ? animClass : ""}
                  ${isCorrect ? "bg-[#EAF6DC] border-[#4F7F2D]" : isWrong ? "bg-[#FFE5DF] border-[#C94B3C]" : "bg-[#FFFDF7] border-[#1E1C18]"}`}>
                {opt}
                {isCorrect && <span className="float-right text-[#4F7F2D]">✓</span>}
                {isWrong && <span className="float-right text-[#C94B3C]">✗</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {(() => {
            const correct = quizWord(word.word);
            const altCorrect = word.alt ? quizWord(word.alt) : "";
            const isInputCorrect = inputVal.trim() === correct || (altCorrect && inputVal.trim() === altCorrect);
            return (
              <>
                <input ref={inputRef} value={inputVal} onChange={e => setInputVal(e.target.value)}
                  onKeyDown={e => e.key==="Enter" && !answered && checkAnswer(inputVal)}
                  disabled={answered}
                  placeholder="한국어로 입력하세요"
                  className={`w-full border-2 rounded-[24px] px-5 py-4 text-lg font-bold outline-none transition-all ${answered ? (isInputCorrect ? "border-[#4F7F2D] bg-[#EAF6DC]" : "border-[#C94B3C] bg-[#FFE5DF]") : "border-[#1E1C18] bg-[#FFFDF7] focus:border-[#6D5DF6]"}`}
                  style={{ fontFamily:"'Noto Sans KR',sans-serif" }}/>
                {answered && !isInputCorrect && (
                  <p className="text-sm text-[#686157] px-2">正确答案：<strong style={{ fontFamily:"'Noto Sans KR',sans-serif" }}>{correct}{altCorrect ? ` / ${altCorrect}` : ""}</strong></p>
                )}
              </>
            );
          })()}
          {!answered && (
            <button onClick={() => checkAnswer(inputVal)}
              className="w-full py-3 rounded-[24px] bg-[#6D5DF6] text-white font-bold border-2 border-[#1E1C18] shadow-[0_5px_0_#1E1C18] active:translate-y-1 active:shadow-[0_1px_0_#1E1C18] transition-all">
              확인
            </button>
          )}
        </div>
      )}

      {answered && (
        <div className="flex gap-3">
          <button onClick={markGuess}
            className="flex-1 py-3 rounded-[24px] border-2 border-[#1E1C18] bg-[#FFFDF7] font-bold text-sm shadow-[0_3px_0_#1E1C18] active:translate-y-0.5 active:shadow-[0_1px_0_#1E1C18] transition-all">
            我是猜的
          </button>
          <button onClick={nextItem}
            className="flex-1 py-3 rounded-[24px] bg-[#6D5DF6] text-white font-bold border-2 border-[#1E1C18] shadow-[0_5px_0_#1E1C18] active:translate-y-1 active:shadow-[0_1px_0_#1E1C18] transition-all">
            下一个 ›
          </button>
        </div>
      )}
      {!answered && (
        <button onClick={markGuess}
          className="w-full py-2 rounded-[20px] border border-[rgba(30,28,24,0.16)] bg-[#FFFDF7] text-[#8A8174] text-sm active:opacity-70 transition-all">
          我是猜的（跳过此题）
        </button>
      )}
    </div>
  );
}

// ─── 进度页 ───────────────────────────────────────────────────────────────
function ProgressPage({ progress, setProgress, dailyCount, setDailyCount, examDate, setExamDate, dailyGoal, setDailyGoal }) {
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [userApiKey, setUserApiKey] = useState(() => { try { return localStorage.getItem("topik_user_api_key")||""; } catch(e){ return ""; } });
  const [userApiProvider, setUserApiProvider] = useState(() => { try { return localStorage.getItem("topik_user_api_provider")||"anthropic"; } catch(e){ return "anthropic"; } });
  const [apiKeyMsg, setApiKeyMsg] = useState("");

  const stats = useMemo(() => {
    let learning=0, mastered=0;
    Object.values(progress).forEach(p => {
      if (p.status==="mastered") mastered++;
      else if (p.status==="learning") learning++;
    });
    return { total: VOCAB.length, learning, mastered, untouched: VOCAB.length-learning-mastered };
  }, [progress]);

  const dueCount = useMemo(() => {
    const now = Date.now();
    return VOCAB.filter(v => { const p=progress[v.id]; return p&&p.status==="learning"&&p.nextReview&&p.nextReview<=now; }).length;
  }, [progress]);

  function resetAll() {
    if (!confirm("确定清空所有进度？此操作不可恢复。")) return;
    setProgress({});
    setDailyCount({ date: todayKey(), used: 0 });
    setImportMsg("已重置");
  }

  function saveApiKey() {
    try {
      if (userApiKey.trim()) {
        localStorage.setItem("topik_user_api_key", userApiKey.trim());
        localStorage.setItem("topik_user_api_provider", userApiProvider);
        setApiKeyMsg(`已保存（${userApiProvider==="deepseek"?"DeepSeek":"Anthropic"}）`);
      } else {
        localStorage.removeItem("topik_user_api_key");
        localStorage.removeItem("topik_user_api_provider");
        setApiKeyMsg("已清除");
      }
    } catch(e) { setApiKeyMsg("保存失败"); }
  }

  const exportData = JSON.stringify(progress);

  return (
    <div className="space-y-4">
      {/* 统计卡 */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label:"总词数", val: stats.total, color:"text-[#181713]" },
          { label:"未学习", val: stats.untouched, color:"text-[#686157]" },
          { label:"复习中", val: stats.learning, color:"text-[#6D5DF6]" },
          { label:"已掌握", val: stats.mastered, color:"text-[#93C85F]" },
        ].map(s => (
          <div key={s.label} className="rounded-[22px] bg-[#FFFDF7] border border-[rgba(30,28,24,0.16)] p-4 shadow-[0_8px_20px_rgba(30,28,24,0.10)]">
            <div className={`text-3xl font-bold ${s.color}`} style={{ fontFamily:"Georgia,serif" }}>{s.val}</div>
            <div className="text-xs text-[#8A8174] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 考试日期设置 */}
      <div className="rounded-[22px] bg-[#FFFDF7] border border-[rgba(30,28,24,0.16)] p-5 shadow-[0_8px_20px_rgba(30,28,24,0.10)]">
        <p className="text-sm font-bold mb-1">考试日期</p>
        <p className="text-xs text-[#686157] mb-3">设置后主页会显示倒计时和学习进度建议。</p>
        <input
          type="date"
          value={examDate}
          onChange={e => setExamDate(e.target.value)}
          className="w-full text-sm border border-[rgba(30,28,24,0.16)] rounded-[16px] p-3 bg-[#FFFDF7] mb-2"
        />
        {examDate && (
          <button onClick={() => setExamDate("")}
            className="text-xs text-[#8A8174] underline">
            清除
          </button>
        )}
      </div>

      {/* 每日词量设置 */}
      <div className="rounded-[22px] bg-[#FFFDF7] border border-[rgba(30,28,24,0.16)] p-5 shadow-[0_8px_20px_rgba(30,28,24,0.10)]">
        <p className="text-sm font-bold mb-1">每日学习目标</p>
        <p className="text-xs text-[#686157] mb-3">调整每天新词上限（1–50个），影响学习页进度和主页计划推算。</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDailyGoal(Math.max(1, dailyGoal - 1))}
            className="w-10 h-10 rounded-[12px] bg-[#F6F0E4] border-2 border-[#1E1C18] shadow-[0_3px_0_#1E1C18] font-bold text-lg flex items-center justify-center active:translate-y-0.5 active:shadow-[0_1px_0_#1E1C18] transition-all select-none">−</button>
          <input
            type="number" min="1" max="50"
            value={dailyGoal}
            onChange={e => {
              const v = parseInt(e.target.value);
              if (!isNaN(v)) setDailyGoal(Math.min(50, Math.max(1, v)));
            }}
            className="flex-1 text-center text-xl font-bold border-2 border-[#1E1C18] rounded-[16px] py-2 bg-[#FFFDF7] outline-none focus:border-[#6D5DF6]"
            style={{ fontFamily:"Georgia,serif" }}/>
          <button
            onClick={() => setDailyGoal(Math.min(50, dailyGoal + 1))}
            className="w-10 h-10 rounded-[12px] bg-[#F6F0E4] border-2 border-[#1E1C18] shadow-[0_3px_0_#1E1C18] font-bold text-lg flex items-center justify-center active:translate-y-0.5 active:shadow-[0_1px_0_#1E1C18] transition-all select-none">+</button>
        </div>
        <p className="text-xs text-[#8A8174] mt-2 text-center">个 / 天</p>
      </div>

      {/* 今日到期 */}
      <div className="rounded-[22px] bg-[#EAE7FF] border border-[rgba(30,28,24,0.16)] p-4 flex justify-between items-center">
        <span className="text-sm font-bold">今日到期复习</span>
        <span className="text-2xl font-bold text-[#6D5DF6]" style={{ fontFamily:"Georgia,serif" }}>{dueCount}</span>
      </div>

      {/* 进度备份 */}
      <div className="rounded-[22px] bg-[#FFFDF7] border border-[rgba(30,28,24,0.16)] p-5 shadow-[0_8px_20px_rgba(30,28,24,0.10)]">
        <p className="text-sm font-bold mb-1">进度备份</p>
        <p className="text-xs text-[#686157] mb-3">进度自动保存在本设备浏览器中。换设备前请备份。</p>
        <button onClick={() => setShowExport(!showExport)}
          className="w-full py-2.5 rounded-[20px] bg-[#6D5DF6] text-white font-bold border-2 border-[#1E1C18] shadow-[0_4px_0_#1E1C18] active:translate-y-0.5 active:shadow-[0_1px_0_#1E1C18] transition-all text-sm mb-3">
          {showExport ? "收起" : "显示导出文本"}
        </button>
        {showExport && (
          <textarea readOnly value={exportData} onFocus={e=>e.target.select()}
            className="w-full h-20 text-xs border border-[rgba(30,28,24,0.16)] rounded-[16px] p-3 font-mono bg-[#F6F0E4] mb-3"/>
        )}
        <p className="text-xs text-[#8A8174] mb-1">导入：粘贴备份内容后应用</p>
        <textarea value={importText} onChange={e=>setImportText(e.target.value)} placeholder="粘贴进度JSON…"
          className="w-full h-16 text-xs border border-[rgba(30,28,24,0.16)] rounded-[16px] p-3 font-mono bg-[#FFFDF7] mb-2"/>
        <button onClick={() => { try { setProgress(JSON.parse(importText)); setImportMsg("导入成功"); } catch(e){ setImportMsg("格式错误"); }}}
          className="w-full py-2 rounded-[16px] bg-[#F6F0E4] border border-[rgba(30,28,24,0.16)] text-sm font-bold active:opacity-80 transition-all">
          应用导入
        </button>
        {importMsg && <p className="text-xs text-[#93C85F] mt-1">{importMsg}</p>}
        <button onClick={resetAll} className="w-full py-2.5 mt-3 rounded-[20px] bg-[#FFE5DF] text-[#C94B3C] font-bold border border-[#C94B3C] text-sm active:opacity-80 transition-all">
          重置全部进度
        </button>
      </div>

      {/* API Key */}
      <div className="rounded-[22px] bg-[#FFFDF7] border border-[rgba(30,28,24,0.16)] p-5 shadow-[0_8px_20px_rgba(30,28,24,0.10)]">
        <p className="text-sm font-bold mb-1">例句生成 · API Key</p>
        <p className="text-xs text-[#686157] mb-3">填入你自己的Key，仅存储在本设备，不会上传到任何服务器。</p>
        <select value={userApiProvider} onChange={e=>setUserApiProvider(e.target.value)}
          className="w-full text-sm border border-[rgba(30,28,24,0.16)] rounded-[16px] p-2.5 mb-2 bg-[#FFFDF7]">
          <option value="anthropic">Anthropic Claude（海外用户）</option>
          <option value="deepseek">DeepSeek（国内用户，无需翻墙）</option>
        </select>
        <input type="password" value={userApiKey} onChange={e=>setUserApiKey(e.target.value)}
          placeholder={userApiProvider==="deepseek" ? "sk-..." : "sk-ant-..."}
          className="w-full text-xs border border-[rgba(30,28,24,0.16)] rounded-[16px] p-3 font-mono mb-2 bg-[#FFFDF7]"/>
        <button onClick={saveApiKey}
          className="w-full py-2.5 rounded-[20px] bg-[#F6F0E4] border border-[rgba(30,28,24,0.16)] text-sm font-bold active:opacity-80 transition-all">
          保存
        </button>
        {apiKeyMsg && <p className="text-xs text-[#93C85F] mt-1">{apiKeyMsg}</p>}
      </div>
    </div>
  );
}

// ─── 主 App ───────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("home");

  // 每日词量
  const [dailyGoal, setDailyGoalRaw] = useState(() => {
    try { return parseInt(localStorage.getItem("topik_daily_goal") || "36"); } catch(e) { return 36; }
  });
  const setDailyGoal = (val) => {
    setDailyGoalRaw(val);
    try { localStorage.setItem("topik_daily_goal", String(val)); } catch(e) {}
  };

  // 考试日期
  const [examDate, setExamDateRaw] = useState(() => {
    try { return localStorage.getItem("topik_exam_date") || ""; } catch(e){ return ""; }
  });
  const setExamDate = (val) => {
    setExamDateRaw(val);
    try { localStorage.setItem("topik_exam_date", val); } catch(e){}
  };

  // 进度数据
  const [progress, setProgressRaw] = useState(() => {
    try { const s=localStorage.getItem("topik_progress"); return s?JSON.parse(s):{}; } catch(e){ return {}; }
  });
  const setProgress = (val) => {
    const next = typeof val==="function" ? val(progress) : val;
    setProgressRaw(next);
    try { localStorage.setItem("topik_progress", JSON.stringify(next)); } catch(e){}
  };

  const [dailyCount, setDailyCountRaw] = useState(() => {
    try { const s=localStorage.getItem("topik_daily_count"); return s?JSON.parse(s):{date:todayKey(),used:0}; } catch(e){ return {date:todayKey(),used:0}; }
  });
  const setDailyCount = (val) => {
    const next = typeof val==="function" ? val(dailyCount) : val;
    setDailyCountRaw(next);
    try { localStorage.setItem("topik_daily_count", JSON.stringify(next)); } catch(e){}
  };

  const [showCelebration, setShowCelebration] = useState(false);
  const [celebStats, setCelebStats] = useState({});



  // streak从progress实时推算，不依赖独立calendar存储
  const streak = useMemo(() => {
    let s = 0, d = new Date();
    // 今天还没学过词时，从昨天开始数（给当天宽限）
    const todayState = getDayState(d.toDateString(), progress, dailyGoal);
    if (todayState === "none" || todayState === "today") {
      d.setDate(d.getDate() - 1);
    }
    while (true) {
      const state = getDayState(d.toDateString(), progress, dailyGoal);
      if (state === "full" || state === "new") { s++; d.setDate(d.getDate() - 1); }
      else break;
    }
    return s;
  }, [progress, dailyGoal]);

  function handleStudyComplete() {
    const mastered = Object.values(progress).filter(p=>p.status==="mastered").length;
    const learning = Object.values(progress).filter(p=>p.status==="learning").length;
    setCelebStats({ learned: dailyCount.used||36, accuracy: 85, streak: streak+1 });
    setShowCelebration(true);
  }

  const navItems = [
    { key:"home", label:"主页", icon: Icons.home },
    { key:"study", label:"学习", icon: Icons.study },
    { key:"quiz", label:"测验", icon: Icons.quiz },
    { key:"progress", label:"进度", icon: Icons.progress },
  ];

  return (
    <>
      {/* CSS 动画 */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;900&display=swap');
        body { background: #F6F0E4; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
        @keyframes correctBounce {
          0%{transform:scale(1)} 35%{transform:scale(1.04)} 65%{transform:scale(0.98)} 100%{transform:scale(1)}
        }
        @keyframes wrongShake {
          0%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} 100%{transform:translateX(0)}
        }
        @keyframes floatUp {
          0%{opacity:0;transform:translateY(16px) rotate(0deg) scale(0.9)}
          20%{opacity:1}
          100%{opacity:0;transform:translateY(-80px) rotate(16deg) scale(1.1)}
        }
        .animate-correct { animation: correctBounce 280ms ease-out; }
        .animate-wrong { animation: wrongShake 320ms ease-in-out; }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; } }
      `}</style>

      <div className="min-h-screen pb-28">
        {/* 顶部标题 */}
        <div className="max-w-2xl mx-auto px-4 pt-8 pb-4">
          <div className="flex items-center gap-2 mb-6">
            <span className="text-lg">📖</span>
            <div>
              <h1 className="font-black text-sm tracking-wide">懒背 TOPIK</h1>
              <p className="text-xs text-[#8A8174]" style={{ fontFamily:"'Noto Sans KR',sans-serif" }}>게으른 학습법</p>
            </div>
            <div className="ml-auto flex items-center gap-1 text-sm">
              <span>🔥</span>
              <span className="font-bold" style={{ fontFamily:"Georgia,serif" }}>{streak}</span>
            </div>
          </div>

          {/* 页面内容 */}
          {tab==="home" && <HomePage progress={progress} dailyCount={dailyCount} streak={streak} examDate={examDate} dailyGoal={dailyGoal}/>}
          {tab==="study" && <StudyPage progress={progress} dailyCount={dailyCount} setProgress={setProgress} setDailyCount={setDailyCount} onComplete={handleStudyComplete} dailyGoal={dailyGoal}/>}
          {tab==="quiz" && <QuizPage progress={progress} setProgress={setProgress}/>}
          {tab==="progress" && <ProgressPage progress={progress} setProgress={setProgress} dailyCount={dailyCount} setDailyCount={setDailyCount} examDate={examDate} setExamDate={setExamDate} dailyGoal={dailyGoal} setDailyGoal={setDailyGoal}/>}
        </div>
      </div>

      {/* 底部导航 pill */}
      <nav className="fixed left-1/2 bottom-4 -translate-x-1/2 z-40"
        style={{ width:"min(520px, calc(100% - 24px))", height:"68px",
          background:"rgba(255,253,247,0.92)", backdropFilter:"blur(16px)",
          border:"2px solid #1E1C18", borderRadius:"999px",
          boxShadow:"0 6px 0 #1E1C18",
          display:"grid", gridTemplateColumns:"repeat(4,1fr)", padding:"8px" }}>
        {navItems.map(({ key, label, icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex flex-col items-center justify-center gap-0.5 rounded-full transition-all text-xs font-bold ${tab===key ? "bg-[#EAE7FF] text-[#4B3BC8]" : "text-[#686157]"}`}>
            {icon}
            <span style={{ fontFamily:"'Noto Sans KR',sans-serif" }}>{label}</span>
          </button>
        ))}
      </nav>

      {/* 庆祝弹窗 */}
      {showCelebration && <CelebrationOverlay stats={celebStats} onClose={() => setShowCelebration(false)}/>}
    </>
  );
}
