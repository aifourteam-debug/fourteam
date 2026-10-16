import React, { useState, useEffect, useRef } from 'react';
import { TextItem, QuestionItem, QuizGradingResult, QuestionLevel } from '../types';
import { useAuth } from '../context/AuthContext';
import { 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  HelpCircle, 
  Lightbulb, 
  ArrowRight, 
  RotateCcw, 
  Sparkles, 
  Bot, 
  Award, 
  BookOpen, 
  Send, 
  Check, 
  Gamepad2,
  PenTool,
  Layers,
  ChevronDown,
  ChevronUp,
  Coins,
  FileText,
  Lock,
  Unlock,
  AlertTriangle,
  RefreshCw,
  Loader2
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { createRipple } from '../utils/interactiveEffects';

interface QuizSystemProps {
  text: TextItem;
  onBackToReading: () => void;
  onGoToGames: () => void;
  onOpenAssistantForHint: (question: string) => void;
}

export type QuizStatus = 'not_started' | 'in_progress' | 'ready_to_submit' | 'grading' | 'completed';

export const LEVEL_CONFIG: Record<string, { 
  label: string; 
  short: string;
  badge: string; 
  border: string;
  bgLight: string;
  icon: string;
  desc: string;
}> = {
  'nhan-biet': { 
    label: 'Mức 1: Nhận biết', 
    short: 'Nhận biết',
    badge: 'bg-sky-100 text-sky-800 border-sky-200', 
    border: 'border-sky-200',
    bgLight: 'bg-sky-50/40',
    icon: '🔍',
    desc: 'Nhận biết chi tiết, nhân vật, bối cảnh, từ ngữ, thể loại trong văn bản.'
  },
  'thong-hieu': { 
    label: 'Mức 2: Thông hiểu', 
    short: 'Thông hiểu',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', 
    border: 'border-emerald-200',
    bgLight: 'bg-emerald-50/40',
    icon: '💡',
    desc: 'Hiểu ý nghĩa hình ảnh, tư tưởng tác giả, chủ đề và cảm xúc của bài đọc.'
  },
  'van-dung': { 
    label: 'Mức 3: Vận dụng', 
    short: 'Vận dụng',
    badge: 'bg-amber-100 text-amber-800 border-amber-200', 
    border: 'border-amber-200',
    bgLight: 'bg-amber-50/40',
    icon: '🚀',
    desc: 'Rút ra bài học, thông điệp cuộc sống, liên hệ với bản thân và thực tiễn.'
  },
  'tu-duy-nang-cao': { 
    label: 'Mức 4: Vận dụng cao', 
    short: 'Vận dụng cao',
    badge: 'bg-purple-100 text-purple-800 border-purple-200', 
    border: 'border-purple-200',
    bgLight: 'bg-purple-50/40',
    icon: '✨',
    desc: 'Tư duy phản biện, liên hệ văn học đa chiều và sáng tạo quan điểm mới.'
  }
};

export const QuizSystem: React.FC<QuizSystemProps> = ({
  text,
  onBackToReading,
  onGoToGames,
  onOpenAssistantForHint
}) => {
  const { user, completeReading } = useAuth();
  const questions = text.questions;

  // View modes: 'worksheet' (Khuyên dùng) | 'step-by-step'
  const [viewMode, setViewMode] = useState<'worksheet' | 'step-by-step'>('worksheet');
  const [levelFilter, setLevelFilter] = useState<'all' | 'nhan-biet' | 'thong-hieu' | 'van-dung'>('all');
  const [currentIndex, setCurrentIndex] = useState(0);

  // User typed / selected answers
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>(() => {
    try {
      const draftKey = `readmind_quiz_draft_${user?.username || 'guest'}_${text.id}`;
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {}
    return {};
  });

  // State machine for submission & grading:
  // not_started -> in_progress -> ready_to_submit -> grading -> completed
  const [quizStatus, setQuizStatus] = useState<QuizStatus>('not_started');
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Result and grading
  const [gradingResult, setGradingResult] = useState<QuizGradingResult | null>(null);
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<string, string>>({});
  const [rewardEarned, setRewardEarned] = useState<{ coins: number; xp: number; isFirstTime: boolean } | null>(null);

  // UI toggles
  const [showHint, setShowHint] = useState<Record<string, boolean>>({});
  const [showModelAnswer, setShowModelAnswer] = useState<Record<string, boolean>>({});
  const [showExplanationBox, setShowExplanationBox] = useState<Record<string, boolean>>({});

  // Auto-save draft
  useEffect(() => {
    if (quizStatus !== 'completed') {
      try {
        const draftKey = `readmind_quiz_draft_${user?.username || 'guest'}_${text.id}`;
        localStorage.setItem(draftKey, JSON.stringify(userAnswers));
      } catch {}
    }
  }, [userAnswers, user?.username, text.id, quizStatus]);

  // Check whether a specific question has a valid answer
  const isQuestionAnswered = (q: QuestionItem): boolean => {
    const val = userAnswers[q.id];
    return typeof val === 'string' && val.trim().length > 0;
  };

  const answeredCount = questions.filter(q => isQuestionAnswered(q)).length;
  const totalCount = questions.length;
  const isAllAnswered = totalCount > 0 && answeredCount === totalCount;
  const remainingCount = totalCount - answeredCount;

  // Sync quiz status based on answers if not grading or completed
  useEffect(() => {
    if (quizStatus === 'grading' || quizStatus === 'completed') return;

    if (answeredCount === 0) {
      setQuizStatus('not_started');
    } else if (answeredCount < totalCount) {
      setQuizStatus('in_progress');
    } else {
      setQuizStatus('ready_to_submit');
    }
  }, [answeredCount, totalCount, quizStatus]);

  // Counts for 3 levels
  const nhanBietCount = questions.filter(q => q.level === 'nhan-biet').length;
  const thongHieuCount = questions.filter(q => q.level === 'thong-hieu').length;
  const vanDungCount = questions.filter(q => q.level === 'van-dung' || q.level === 'tu-duy-nang-cao').length;

  // Filtered questions
  const filteredQuestions = questions.filter(q => {
    if (levelFilter === 'all') return true;
    if (levelFilter === 'van-dung') return q.level === 'van-dung' || q.level === 'tu-duy-nang-cao';
    return q.level === levelFilter;
  });

  const currentQuestion = questions[currentIndex] || questions[0];

  const handleTextAnswerChange = (questionId: string, val: string) => {
    setUserAnswers(prev => ({ ...prev, [questionId]: val }));
    if (errorMessage) setErrorMessage(null);
  };

  const isSubmittingRef = useRef(false);

  // Submit and grade the entire quiz
  const handleSubmitQuiz = async () => {
    if (quizStatus === 'grading' || isSubmittingRef.current) return;

    // 1. Strict validation: 100% completion required
    if (!isAllAnswered) {
      setValidationAttempted(true);
      setErrorMessage(`Em cần hoàn thành tất cả câu hỏi trước khi nộp bài nhé! (Còn ${remainingCount} câu chưa trả lời)`);
      
      const firstUnanswered = questions.find(q => !isQuestionAnswered(q));
      if (firstUnanswered) {
        if (viewMode === 'step-by-step') {
          const idx = questions.findIndex(q => q.id === firstUnanswered.id);
          if (idx !== -1) setCurrentIndex(idx);
        } else {
          // Switch filter to all if needed so element is visible
          if (levelFilter !== 'all') {
            setLevelFilter('all');
          }
          setTimeout(() => {
            const el = document.getElementById(`question-card-${firstUnanswered.id}`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 100);
        }
      }
      return;
    }

    // 2. Start grading state
    isSubmittingRef.current = true;
    setValidationAttempted(false);
    setErrorMessage(null);
    setQuizStatus('grading');

    try {
      const res = await fetch('/api/grade-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          textId: text.id,
          textTitle: text.title,
          textContent: text.content.slice(0, 1500),
          grade: text.grade,
          questions: text.questions,
          studentAnswers: userAnswers
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Đã có lỗi khi gửi bài chấm điểm.');
      }

      const data: QuizGradingResult = await res.json();
      setGradingResult(data);
      setSubmittedAnswers({ ...userAnswers });

      // Auto-unlock SGK answers after legitimate submission
      const modelMap: Record<string, boolean> = {};
      questions.forEach(q => { modelMap[q.id] = true; });
      setShowModelAnswer(modelMap);

      // 3. Strict reward logic
      const rewardedList = user?.rewardedQuizTextIds || [];
      const isAlreadyRewarded = rewardedList.includes(text.id) ||
        (typeof window !== 'undefined' && localStorage.getItem(`readmind_rewarded_${user?.username || 'guest'}_${text.id}`) === 'true');

      const finalScore = data.overallScore;

      // Call completeReading with the final quiz score
      completeReading(text.id, text.title, 100, 120, finalScore);

      if (!isAlreadyRewarded) {
        const earnedCoins = 25 + Math.round(finalScore / 5);
        const earnedXP = 50 + Math.round(finalScore / 2);
        setRewardEarned({ coins: earnedCoins, xp: earnedXP, isFirstTime: true });
        try {
          localStorage.setItem(`readmind_rewarded_${user?.username || 'guest'}_${text.id}`, 'true');
        } catch {}
      } else {
        setRewardEarned({ coins: 0, xp: 0, isFirstTime: false });
      }

      // Transition to completed
      setQuizStatus('completed');

      if (finalScore >= 70) {
        try {
          confetti({ particleCount: 75, spread: 70, origin: { y: 0.6 } });
        } catch {}
      }

      // Clear draft
      try {
        localStorage.removeItem(`readmind_quiz_draft_${user?.username || 'guest'}_${text.id}`);
      } catch {}

      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      console.error('Submit quiz error:', err);
      setErrorMessage(err.message || 'Không thể kết nối với hệ thống chấm điểm AI. Em hãy kiểm tra mạng và bấm Thử lại nhé!');
      setQuizStatus(isAllAnswered ? 'ready_to_submit' : 'in_progress');
    } finally {
      isSubmittingRef.current = false;
    }
  };

  // Retake quiz
  const handleRetakeQuiz = () => {
    setUserAnswers({});
    setSubmittedAnswers({});
    setGradingResult(null);
    setValidationAttempted(false);
    setErrorMessage(null);
    setQuizStatus('not_started');
    setCurrentIndex(0);
    try {
      localStorage.removeItem(`readmind_quiz_draft_${user?.username || 'guest'}_${text.id}`);
    } catch {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const bestScore = user?.quizScores?.[text.id];
  const isAlreadyRewardedUser = (user?.rewardedQuizTextIds || []).includes(text.id);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6 font-sans">
      
      {/* TOP HEADER & NAVIGATION */}
      <div className="bg-white p-4 sm:p-5 rounded-3xl border border-[#E0EBF4] shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <button
            onClick={(e) => {
              createRipple(e);
              onBackToReading();
            }}
            className="btn-soft-pastel ripple-container text-xs font-semibold px-3 py-2 rounded-xl flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
          >
            <BookOpen className="w-4 h-4 text-[#00A99D]" />
            <span>Về bài đọc</span>
          </button>

          <div>
            <h2 className="text-sm sm:text-base font-bold text-[#102A43] line-clamp-1">
              Phần đọc hiểu: {text.title}
            </h2>
            <p className="text-[11px] text-[#61758A] font-medium">
              Chương trình GDPT 2018 &bull; Lớp {text.grade} &bull; {questions.length} câu hỏi 3 mức độ
            </p>
          </div>
        </div>

        {/* View Mode Switcher */}
        {quizStatus !== 'completed' && quizStatus !== 'grading' && (
          <div className="flex items-center bg-[#F4FAFF] p-1 rounded-2xl border border-[#E0EBF4] text-xs font-semibold">
            <button
              onClick={(e) => {
                createRipple(e);
                setViewMode('worksheet');
              }}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center space-x-1.5 cursor-pointer ${
                viewMode === 'worksheet'
                  ? 'bg-[#00A99D] text-white shadow-xs font-bold'
                  : 'text-[#61758A] hover:text-[#102A43]'
              }`}
            >
              <FileText className={`w-3.5 h-3.5 ${viewMode === 'worksheet' ? 'text-white' : 'text-[#61758A]'}`} />
              <span>Phiếu đọc hiểu</span>
            </button>

            <button
              onClick={(e) => {
                createRipple(e);
                setViewMode('step-by-step');
              }}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center space-x-1.5 cursor-pointer ${
                viewMode === 'step-by-step'
                  ? 'bg-[#00A99D] text-white shadow-xs font-bold'
                  : 'text-[#61758A] hover:text-[#102A43]'
              }`}
            >
              <Layers className={`w-3.5 h-3.5 ${viewMode === 'step-by-step' ? 'text-white' : 'text-[#61758A]'}`} />
              <span>Luyện từng câu</span>
            </button>
          </div>
        )}
      </div>

      {/* RETAKE NOTICE IF USER PREVIOUSLY COMPLETED */}
      {isAlreadyRewardedUser && quizStatus !== 'completed' && (
        <div className="bg-[#FFF8E7] border border-[#F2B544]/50 rounded-2xl p-3 sm:p-4 text-xs text-[#8A5800] flex items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <Award className="w-4 h-4 text-[#D97706] shrink-0" />
            <span>
              Em đã từng hoàn thành bài này (Điểm cao nhất: <strong>{bestScore !== undefined ? bestScore : 100}/100</strong>). Lần làm lại này hệ thống vẫn chấm điểm & nhận xét đầy đủ, nhưng không cộng thêm xu/kinh nghiệm.
            </span>
          </div>
        </div>
      )}

      {/* QUIZ STATUS LIFECYCLE BAR */}
      {quizStatus !== 'completed' && quizStatus !== 'grading' && (
        <div className="bg-white p-4 rounded-2xl border border-[#E0EBF4] shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs font-bold">
            <div className="flex items-center space-x-2">
              <span className={`w-2.5 h-2.5 rounded-full ${
                quizStatus === 'ready_to_submit' 
                  ? 'bg-[#00A99D] animate-ping' 
                  : quizStatus === 'in_progress' 
                  ? 'bg-[#3285E8]' 
                  : 'bg-stone-300'
              }`} />
              <span className="text-[#102A43]">
                {quizStatus === 'not_started' && 'Trạng thái: Chưa bắt đầu'}
                {quizStatus === 'in_progress' && `Trạng thái: Đang làm bài (${answeredCount}/${totalCount} câu)`}
                {quizStatus === 'ready_to_submit' && 'Trạng thái: Đã hoàn thành 100% câu hỏi &bull; Sẵn sàng nộp bài!'}
              </span>
            </div>

            <span className={isAllAnswered ? 'text-[#007F76] font-extrabold' : 'text-[#61758A]'}>
              {Math.round((answeredCount / totalCount) * 100)}%
            </span>
          </div>

          <div className="w-full bg-[#E0EBF4] h-2 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-300 rounded-full ${
                isAllAnswered ? 'bg-[#00A99D]' : 'bg-[#3285E8]'
              }`}
              style={{ width: `${Math.round((answeredCount / totalCount) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* ERROR / VALIDATION ALERT MESSAGE */}
      {errorMessage && (
        <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-4 text-xs sm:text-sm text-rose-800 flex items-start space-x-3 shadow-xs animate-shake">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold">{errorMessage}</p>
            {remainingCount > 0 && quizStatus !== 'grading' && (
              <p className="text-xs text-rose-700">
                Hãy kiểm tra các ô có viền đỏ bên dưới và bổ sung câu trả lời trước khi gửi chấm điểm nhé.
              </p>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
                                1. GRADING IN PROGRESS SCREEN
          ========================================================================= */}
      {quizStatus === 'grading' && (
        <div className="bg-white rounded-3xl p-8 sm:p-12 border border-[#E0EBF4] shadow-md text-center space-y-6 max-w-xl mx-auto animate-in fade-in">
          <div className="w-20 h-20 bg-gradient-to-tr from-[#00A99D] to-[#3285E8] rounded-3xl mx-auto flex items-center justify-center shadow-lg shadow-[#00A99D]/20 animate-pulse">
            <Sparkles className="w-10 h-10 text-white animate-spin" />
          </div>

          <div className="space-y-2">
            <h3 className="text-xl sm:text-2xl font-extrabold text-[#102A43]">
              Cô giáo ReadMind AI đang chấm bài...
            </h3>
            <p className="text-xs sm:text-sm text-[#61758A] leading-relaxed max-w-md mx-auto">
              Hệ thống đang kiểm tra đáp án trắc nghiệm và đánh giá chi tiết câu trả lời tự luận theo chuẩn GDPT 2018 cho tác phẩm "{text.title}".
            </p>
          </div>

          <div className="w-full bg-[#E0EBF4] h-2.5 rounded-full overflow-hidden">
            <div className="bg-gradient-to-r from-[#00A99D] to-[#3285E8] h-full w-3/4 animate-pulse rounded-full" />
          </div>

          <div className="flex items-center justify-center space-x-2 text-xs font-bold text-[#007F76]">
            <Loader2 className="w-4 h-4 animate-spin text-[#00A99D]" />
            <span>Đang tổng hợp điểm số và lời nhận xét...</span>
          </div>
        </div>
      )}

      {/* =========================================================================
                                2. COMPLETED RESULT SCREEN
          ========================================================================= */}
      {quizStatus === 'completed' && gradingResult && (
        <div className="space-y-6 animate-in fade-in">
          {/* Header Assessment Card */}
          <div className="bg-white rounded-3xl p-6 sm:p-10 border border-[#E0EBF4] shadow-md text-center space-y-6">
            
            {/* Dynamic Icon based on real score */}
            <div className={`w-20 h-20 rounded-3xl mx-auto flex items-center justify-center shadow-lg ${
              gradingResult.overallScore >= 85
                ? 'bg-gradient-to-tr from-[#00A99D] to-[#007F76] text-white shadow-[#00A99D]/25'
                : gradingResult.overallScore >= 70
                ? 'bg-gradient-to-tr from-[#3285E8] to-[#1E65B5] text-white shadow-[#3285E8]/25'
                : gradingResult.overallScore >= 50
                ? 'bg-gradient-to-tr from-[#F2B544] to-[#C07D2B] text-white shadow-[#F2B544]/25'
                : 'bg-gradient-to-tr from-[#E11D48] to-[#BE123C] text-white shadow-rose-500/25'
            }`}>
              {gradingResult.overallScore >= 85 ? (
                <Award className="w-10 h-10 text-white" />
              ) : gradingResult.overallScore >= 70 ? (
                <CheckCircle2 className="w-10 h-10 text-white" />
              ) : gradingResult.overallScore >= 50 ? (
                <Lightbulb className="w-10 h-10 text-white" />
              ) : (
                <RotateCcw className="w-10 h-10 text-white" />
              )}
            </div>

            <div className="space-y-2">
              <h2 className="text-xl sm:text-2xl font-extrabold text-[#102A43]">
                {gradingResult.assessmentTitle}
              </h2>
              <p className="text-xs sm:text-sm text-[#61758A] max-w-lg mx-auto leading-relaxed">
                {gradingResult.overallFeedback}
              </p>
            </div>

            {/* Score Breakdown Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto">
              <div className="p-4 bg-[#F4FAFF] rounded-2xl border border-[#E0EBF4]">
                <p className="text-xs text-[#61758A] font-bold">Điểm bài làm</p>
                <p className="text-2xl sm:text-3xl font-black text-[#102A43] mt-1">
                  {gradingResult.overallScore}<span className="text-sm font-normal text-[#61758A]">/100</span>
                </p>
              </div>

              <div className="p-4 bg-[#FFF8E7] rounded-2xl border border-[#F2B544]/30">
                <p className="text-xs text-[#8A5800] font-bold">Kinh nghiệm & Xu</p>
                <div className="text-xl sm:text-2xl font-black text-[#C07D2B] mt-1 flex items-center justify-center space-x-1">
                  {rewardEarned && rewardEarned.isFirstTime ? (
                    <>
                      <span>+{rewardEarned.coins}</span>
                      <Coins className="w-5 h-5 text-[#F2B544]" />
                    </>
                  ) : (
                    <span className="text-xs font-bold text-[#8A5800]">0 Xu (Làm lại bài)</span>
                  )}
                </div>
                {rewardEarned && rewardEarned.isFirstTime ? (
                  <span className="text-[10px] font-bold text-[#007F76] bg-[#E0F8F3] px-2 py-0.5 rounded-full inline-block mt-1">
                    Thưởng hoàn thành lần đầu
                  </span>
                ) : (
                  <span className="text-[10px] text-[#8A5800] block mt-1">
                    Đã nhận thưởng ở lần làm trước
                  </span>
                )}
              </div>

              <div className="p-4 bg-[#E0F8F3] rounded-2xl border border-[#B2EADF]">
                <p className="text-xs text-[#007F76] font-bold">Chuẩn tư duy</p>
                <p className="text-xs sm:text-sm font-black text-[#007F76] mt-2">
                  {gradingResult.assessmentLevel}
                </p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleRetakeQuiz}
                className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 bg-stone-100 hover:bg-stone-200 text-[#102A43] px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4 text-[#61758A]" />
                <span>Làm lại bài này</span>
              </button>

              <button
                type="button"
                onClick={onGoToGames}
                className="btn-primary-teal ripple-container w-full sm:w-auto inline-flex items-center justify-center space-x-2 text-white px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md cursor-pointer"
              >
                <Gamepad2 className="w-4 h-4" />
                <span>Chơi trò chơi củng cố</span>
              </button>

              <button
                type="button"
                onClick={onBackToReading}
                className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 bg-[#102A43] hover:bg-[#243B53] text-white px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md transition-colors cursor-pointer"
              >
                <BookOpen className="w-4 h-4" />
                <span>Trở về bài đọc</span>
              </button>
            </div>
          </div>

          {/* DETAILED QUESTION-BY-QUESTION REVIEW */}
          <div className="space-y-4">
            <h3 className="text-base sm:text-lg font-extrabold text-[#102A43] flex items-center space-x-2">
              <FileText className="w-5 h-5 text-[#00A99D]" />
              <span>Phân tích chi tiết từng câu hỏi & Nhận xét từ Cô giáo AI</span>
            </h3>

            {questions.map((q, idx) => {
              const qResult = gradingResult.questionResults[q.id];
              const levelInfo = LEVEL_CONFIG[q.level] || LEVEL_CONFIG['nhan-biet'];
              const studentAnswer = submittedAnswers[q.id] || '(Chưa có)';

              return (
                <div
                  key={q.id}
                  className="bg-white rounded-3xl p-5 sm:p-6 border border-[#E0EBF4] shadow-xs space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E0EBF4] pb-3">
                    <div className="flex items-center space-x-2">
                      <span className="font-extrabold text-sm text-[#102A43]">
                        Câu {idx + 1}
                      </span>
                      <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-md border ${levelInfo.badge}`}>
                        {levelInfo.label}
                      </span>
                    </div>

                    {qResult && (
                      <span className={`text-xs font-bold px-3 py-1 rounded-xl flex items-center space-x-1 ${
                        qResult.isCorrect 
                          ? 'bg-[#E0F8F3] text-[#007F76] border border-[#B2EADF]'
                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}>
                        {qResult.isCorrect ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#00A99D]" />
                            <span>Đạt {qResult.score}/10 điểm</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5 text-rose-600" />
                            <span>Chưa đạt ({qResult.score}/10 điểm)</span>
                          </>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Prompt */}
                  <h4 className="text-sm sm:text-base font-bold text-[#102A43]">
                    {q.prompt}
                  </h4>

                  {/* Student Answer */}
                  <div className="p-3.5 rounded-2xl bg-[#F4FAFF] border border-[#E0EBF4] space-y-1">
                    <p className="text-[11px] font-bold text-[#61758A]">Câu trả lời của em:</p>
                    <p className="text-xs sm:text-sm font-medium text-[#102A43] leading-relaxed">
                      {studentAnswer}
                    </p>
                  </div>

                  {/* AI Evaluation */}
                  {qResult && (
                    <div className="p-4 rounded-2xl bg-[#F0FAF7] border border-[#B2EADF] text-xs text-[#102A43] space-y-2">
                      <div className="flex items-center space-x-1.5 font-bold text-[#007F76]">
                        <Bot className="w-4 h-4 text-[#00A99D]" />
                        <span>Nhận xét chi tiết từ Cô giáo ReadMind AI:</span>
                      </div>
                      <p className="leading-relaxed text-[#102A43]">{qResult.feedback}</p>

                      {qResult.praise && (
                        <p className="italic text-[#007F76] font-semibold bg-white p-2.5 rounded-xl border border-[#B2EADF]">
                          ✨ "{qResult.praise}"
                        </p>
                      )}

                      {qResult.suggestions && qResult.suggestions.length > 0 && (
                        <div className="pt-1 space-y-1">
                          <p className="font-bold text-[#102A43]">Gợi ý phát triển câu trả lời:</p>
                          <ul className="list-disc list-inside space-y-1 text-[#61758A] pl-1">
                            {qResult.suggestions.map((sug, sIdx) => (
                              <li key={sIdx}>{sug}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Standard SGK Answer (Fully Unlocked) */}
                  <div className="p-4 bg-[#EAF6FF]/60 rounded-2xl border border-[#C3E4FF] text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="font-bold flex items-center space-x-1.5 text-[#1E65B5]">
                        <CheckCircle2 className="w-4 h-4 text-[#3285E8]" />
                        <span>Chuẩn kiến thức & Đáp án tham khảo SGK:</span>
                      </p>
                      <span className="text-[10px] font-bold text-[#007F76] bg-[#E0F8F3] px-2.5 py-0.5 rounded-full border border-[#B2EADF] flex items-center space-x-1">
                        <Unlock className="w-3 h-3 text-[#00A99D]" />
                        <span>Đã mở khóa</span>
                      </span>
                    </div>
                    <p className="leading-relaxed font-medium text-[#102A43] bg-white p-3 rounded-xl border border-[#D9EFFF]">
                      {q.explanation}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =========================================================================
                                3. WORKSHEET VIEW MODE (PHIẾU ĐỌC HIỂU 3 MỨC ĐỘ)
          ========================================================================= */}
      {viewMode === 'worksheet' && quizStatus !== 'completed' && quizStatus !== 'grading' && (
        <div className="space-y-6 animate-in fade-in">
          
          {/* 3 LEVELS SUMMARY FILTER BUTTONS */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              onClick={(e) => {
                createRipple(e);
                setLevelFilter(levelFilter === 'nhan-biet' ? 'all' : 'nhan-biet');
              }}
              className={`edu-card p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                levelFilter === 'nhan-biet'
                  ? 'bg-[#E0F8F3] border-[#00A99D] ring-2 ring-[#00A99D]/30 shadow-xs'
                  : 'bg-white border-[#E0EBF4] hover:border-[#00A99D]/40 shadow-xs'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#102A43] flex items-center space-x-1.5">
                  <span>🔍</span>
                  <span>1. Nhận biết</span>
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#E0F8F3] text-[#007F76] border border-[#B2EADF]">
                  {nhanBietCount} câu
                </span>
              </div>
              <p className="text-[11px] text-[#61758A] mt-1 leading-normal">
                Xác định chi tiết, nhân vật, thể thơ, từ ngữ trong bài đọc
              </p>
            </button>

            <button
              onClick={(e) => {
                createRipple(e);
                setLevelFilter(levelFilter === 'thong-hieu' ? 'all' : 'thong-hieu');
              }}
              className={`edu-card p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                levelFilter === 'thong-hieu'
                  ? 'bg-[#EAF6FF] border-[#3285E8] ring-2 ring-[#3285E8]/30 shadow-xs'
                  : 'bg-white border-[#E0EBF4] hover:border-[#3285E8]/40 shadow-xs'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#102A43] flex items-center space-x-1.5">
                  <span>💡</span>
                  <span>2. Thông hiểu</span>
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#EAF6FF] text-[#1E65B5] border border-[#C3E4FF]">
                  {thongHieuCount} câu
                </span>
              </div>
              <p className="text-[11px] text-[#61758A] mt-1 leading-normal">
                Hiểu ý nghĩa hình ảnh, tư tưởng tác giả, chủ đề của tác phẩm
              </p>
            </button>

            <button
              onClick={(e) => {
                createRipple(e);
                setLevelFilter(levelFilter === 'van-dung' ? 'all' : 'van-dung');
              }}
              className={`edu-card p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                levelFilter === 'van-dung'
                  ? 'bg-[#FFF8E7] border-[#F2B544] ring-2 ring-[#F2B544]/30 shadow-xs'
                  : 'bg-white border-[#E0EBF4] hover:border-[#F2B544]/40 shadow-xs'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#102A43] flex items-center space-x-1.5">
                  <span>🚀</span>
                  <span>3. Vận dụng</span>
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#FFF8E7] text-[#C07D2B] border border-[#FCE1A8]">
                  {vanDungCount} câu
                </span>
              </div>
              <p className="text-[11px] text-[#61758A] mt-1 leading-normal">
                Rút ra bài học, thông điệp cuộc sống và liên hệ thực tế
              </p>
            </button>
          </div>

          {/* QUESTIONS LIST */}
          <div className="space-y-6">
            {filteredQuestions.map((q) => {
              const originalIndex = questions.findIndex(item => item.id === q.id);
              const levelInfo = LEVEL_CONFIG[q.level] || LEVEL_CONFIG['nhan-biet'];
              const studentText = userAnswers[q.id] || '';
              const isAnswered = isQuestionAnswered(q);
              const isMissingMarked = validationAttempted && !isAnswered;
              const hasOptions = Array.isArray(q.options) && q.options.length > 0;
              const wordCount = studentText.trim() ? studentText.trim().split(/\s+/).filter(Boolean).length : 0;

              return (
                <div
                  id={`question-card-${q.id}`}
                  key={q.id}
                  className={`bg-white rounded-3xl p-5 sm:p-7 border transition-all space-y-4 shadow-xs ${
                    isMissingMarked
                      ? 'border-2 border-rose-500 ring-4 ring-rose-200/50 bg-rose-50/15'
                      : isAnswered
                      ? 'border-[#B2EADF] bg-[#FCFDFD]'
                      : 'border-[#E0EBF4]'
                  }`}
                >
                  {/* Missing Alert Tag */}
                  {isMissingMarked && (
                    <div className="p-2.5 bg-rose-100/90 border border-rose-300 rounded-xl text-xs font-bold text-rose-800 flex items-center space-x-2 animate-bounce">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>Em chưa trả lời câu hỏi này! Cần hoàn thành trước khi nộp bài nhé.</span>
                    </div>
                  )}

                  {/* Question Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E0EBF4] pb-3">
                    <div className="flex items-center space-x-2">
                      <span className="font-extrabold text-sm sm:text-base text-[#102A43]">
                        Câu {originalIndex + 1}
                      </span>
                      <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-md border ${levelInfo.badge}`}>
                        {levelInfo.label}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      {isAnswered ? (
                        <span className="text-[11px] font-bold text-[#007F76] bg-[#E0F8F3] px-2.5 py-1 rounded-full border border-[#B2EADF] flex items-center space-x-1">
                          <Check className="w-3.5 h-3.5 text-[#00A99D]" />
                          <span>Đã trả lời</span>
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 flex items-center space-x-1">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                          <span>Chưa trả lời</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Question Prompt */}
                  <div className="space-y-1">
                    <h3 className="text-base sm:text-lg font-bold text-[#102A43] leading-snug">
                      {q.prompt}
                    </h3>
                    <p className="text-[11px] text-[#61758A] italic">
                      {levelInfo.desc}
                    </p>
                  </div>

                  {/* MULTIPLE CHOICE OPTIONS (If available) */}
                  {hasOptions && q.options && (
                    <div className="space-y-2 pt-1">
                      <label className="text-xs font-bold text-[#102A43] flex items-center space-x-1.5">
                        <Check className="w-3.5 h-3.5 text-[#00A99D]" />
                        <span>Lựa chọn đáp án chính xác:</span>
                      </label>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {q.options.map((opt, oIdx) => {
                          const isSelected = studentText.trim().toLowerCase() === opt.trim().toLowerCase();
                          const optLetter = String.fromCharCode(65 + oIdx);

                          return (
                            <button
                              key={oIdx}
                              type="button"
                              onClick={(e) => {
                                createRipple(e);
                                handleTextAnswerChange(q.id, opt);
                              }}
                              className={`p-3.5 rounded-2xl border text-left flex items-start space-x-3 transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-[#E0F8F3] border-[#00A99D] ring-2 ring-[#00A99D]/40 shadow-xs'
                                  : 'bg-white border-[#E0EBF4] hover:border-[#00A99D]/40 hover:bg-[#F4FAFF]'
                              }`}
                            >
                              <span className={`w-6 h-6 rounded-lg font-bold flex items-center justify-center shrink-0 text-xs ${
                                isSelected
                                  ? 'bg-[#00A99D] text-white shadow-xs'
                                  : 'bg-[#EAF6FF] text-[#1E65B5]'
                              }`}>
                                {optLetter}
                              </span>
                              <span className={`text-xs sm:text-sm leading-relaxed ${
                                isSelected ? 'text-[#007F76] font-bold' : 'text-[#102A43]'
                              }`}>
                                {opt}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {/* Optional Elaboration Box */}
                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={() => setShowExplanationBox(prev => ({ ...prev, [q.id]: !prev[q.id] }))}
                          className="text-xs text-[#61758A] hover:text-[#00A99D] inline-flex items-center space-x-1 font-semibold cursor-pointer"
                        >
                          {showExplanationBox[q.id] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          <span>{showExplanationBox[q.id] ? 'Thu gọn ô phân tích thêm' : 'Viết thêm giải thích / dẫn chứng cho lựa chọn của em (không bắt buộc)'}</span>
                        </button>

                        {showExplanationBox[q.id] && (
                          <div className="mt-2 space-y-1">
                            <textarea
                              value={studentText}
                              onChange={(e) => handleTextAnswerChange(q.id, e.target.value)}
                              placeholder="Em có thể ghi chú thêm lý do vì sao chọn phương án này hoặc dẫn chứng từ văn bản..."
                              rows={2}
                              className="w-full p-3 text-xs rounded-xl border border-[#E0EBF4] focus:outline-none focus:border-[#00A99D] bg-[#F4FAFF] text-[#102A43]"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ESSAY / OPEN OPINION TEXTAREA (Mandatory when no options) */}
                  {!hasOptions && (
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between text-xs">
                        <label className="font-bold text-[#102A43] flex items-center space-x-1.5">
                          <PenTool className="w-3.5 h-3.5 text-[#00A99D]" />
                          <span>Ô để học sinh gõ câu trả lời tự luận (Bắt buộc):</span>
                        </label>
                        <span className={`text-[11px] font-medium ${wordCount > 0 ? 'text-[#00A99D] font-bold' : 'text-[#61758A]'}`}>
                          Đã viết: {wordCount} từ
                        </span>
                      </div>

                      <textarea
                        value={studentText}
                        onChange={(e) => handleTextAnswerChange(q.id, e.target.value)}
                        placeholder="Em hãy gõ câu trả lời của mình vào đây (trình bày rõ ràng, có căn cứ hoặc từ ngữ từ văn bản)..."
                        rows={4}
                        className={`w-full p-4 text-xs sm:text-sm rounded-2xl border focus:outline-none bg-[#F4FAFF] text-[#102A43] leading-relaxed font-sans placeholder:text-[#94A3B8] transition-all ${
                          isMissingMarked
                            ? 'border-rose-400 focus:border-rose-500 ring-2 ring-rose-200'
                            : 'border-[#E0EBF4] focus:border-[#00A99D] focus:ring-1 focus:ring-[#00A99D]'
                        }`}
                      />
                    </div>
                  )}

                  {/* HELPER & HINT BUTTONS */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs border-t border-[#E0EBF4]">
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => setShowHint(prev => ({ ...prev, [q.id]: !prev[q.id] }))}
                        className="text-[#8A5800] bg-[#FFF8E7] hover:bg-[#FCE1A8] px-3 py-1.5 rounded-xl font-bold border border-[#F2B544]/40 transition-colors cursor-pointer"
                      >
                        {showHint[q.id] ? 'Ẩn gợi ý' : '💡 Xem gợi ý suy nghĩ'}
                      </button>

                      {/* Locked SGK Answer Notice: Strictly locked until quiz submission */}
                      <span
                        title="Đáp án chuẩn SGK được bảo mật và chỉ mở sau khi em hoàn thành nộp bài."
                        className="inline-flex items-center space-x-1.5 text-[#61758A] bg-[#F4FAFF] px-3 py-1.5 rounded-xl font-medium border border-[#E0EBF4] text-xs cursor-not-allowed select-none"
                      >
                        <Lock className="w-3.5 h-3.5 text-[#61758A]" />
                        <span>Đáp án SGK (Chỉ mở sau khi nộp bài)</span>
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenAssistantForHint(q.prompt)}
                      className="text-xs text-[#00A99D] hover:underline font-bold inline-flex items-center space-x-1 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#00A99D]" />
                      <span>Hỏi thêm Cô giáo AI về câu này</span>
                    </button>
                  </div>

                  {/* Hint Card */}
                  {showHint[q.id] && (
                    <div className="p-3.5 bg-[#FFF8E7] rounded-2xl border border-[#FCE1A8] text-xs text-[#8A5800] space-y-1 animate-in fade-in">
                      <p className="font-bold flex items-center space-x-1">
                        <Lightbulb className="w-3.5 h-3.5 text-[#D97706]" />
                        <span>Gợi ý định hướng từ sách giáo khoa:</span>
                      </p>
                      <p className="leading-relaxed pl-5 font-medium">{q.hint || 'Hãy đọc kỹ lại các chi tiết trong bài đọc để tìm căn cứ.'}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* BOTTOM SUBMISSION ACTION FOOTER FOR WORKSHEET */}
          <div className="bg-white rounded-3xl p-6 sm:p-7 border border-[#E0EBF4] shadow-md flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <p className="font-extrabold text-sm sm:text-base text-[#102A43]">
                Tiến độ: Đã trả lời {answeredCount} / {questions.length} câu hỏi
              </p>
              <p className="text-xs text-[#61758A] mt-0.5">
                {isAllAnswered 
                  ? 'Em đã hoàn thành đủ 100% câu hỏi! Hãy nhấn nút Nộp bài để Cô giáo AI chấm điểm nhé.'
                  : `Em cần trả lời thêm ${remainingCount} câu nữa để có thể nộp bài.`}
              </p>
            </div>

            <button
              type="button"
              onClick={(e) => {
                createRipple(e);
                handleSubmitQuiz();
              }}
              className={`w-full sm:w-auto inline-flex items-center justify-center space-x-2 text-white px-8 py-3.5 rounded-2xl text-sm font-bold shadow-md transition-all cursor-pointer ${
                isAllAnswered
                  ? 'btn-primary-teal hover:scale-105 shadow-[#00A99D]/25'
                  : 'bg-stone-400 hover:bg-stone-500 opacity-90'
              }`}
            >
              <Send className="w-4 h-4" />
              <span>Nộp bài & Chấm điểm GDPT 2018</span>
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
                                4. STEP-BY-STEP VIEW MODE (LUYỆN TẬP TỪNG CÂU)
          ========================================================================= */}
      {viewMode === 'step-by-step' && quizStatus !== 'completed' && quizStatus !== 'grading' && currentQuestion && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[#E0EBF4] shadow-md space-y-6 animate-in fade-in">
          
          {/* Progress Header */}
          <div className="flex items-center justify-between border-b border-[#E0EBF4] pb-3">
            <span className="text-xs font-bold text-[#61758A]">
              Câu {currentIndex + 1} / {questions.length}
            </span>

            <span className={`text-xs font-bold px-2.5 py-0.5 rounded-md border ${
              LEVEL_CONFIG[currentQuestion.level]?.badge || 'bg-stone-100 text-stone-700'
            }`}>
              {LEVEL_CONFIG[currentQuestion.level]?.label}
            </span>
          </div>

          {/* Question Nav Pills */}
          <div className="flex flex-wrap gap-1.5">
            {questions.map((q, idx) => {
              const isAnswered = isQuestionAnswered(q);
              const isCurrent = idx === currentIndex;
              const isMissing = validationAttempted && !isAnswered;

              return (
                <button
                  key={q.id}
                  onClick={() => setCurrentIndex(idx)}
                  className={`w-8 h-8 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-[#00A99D] text-white shadow-xs'
                      : isMissing
                      ? 'bg-rose-100 text-rose-700 border-2 border-rose-500 animate-pulse'
                      : isAnswered
                      ? 'bg-[#E0F8F3] text-[#007F76] border border-[#B2EADF]'
                      : 'bg-[#F4FAFF] text-[#61758A] border border-[#E0EBF4]'
                  }`}
                  title={`Câu ${idx + 1}: ${isAnswered ? 'Đã trả lời' : isMissing ? 'Chưa trả lời (Cần hoàn thành)' : 'Chưa làm'}`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          {/* Prompt */}
          <div className="space-y-1">
            <h3 className="text-base sm:text-lg font-bold text-[#102A43] leading-snug">
              {currentQuestion.prompt}
            </h3>
            <p className="text-xs text-[#61758A]">
              {LEVEL_CONFIG[currentQuestion.level]?.desc}
            </p>
          </div>

          {/* Options if available */}
          {currentQuestion.options && currentQuestion.options.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-[#102A43] flex items-center space-x-1.5">
                <Check className="w-3.5 h-3.5 text-[#00A99D]" />
                <span>Lựa chọn đáp án:</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {currentQuestion.options.map((opt, oIdx) => {
                  const isSelected = (userAnswers[currentQuestion.id] || '').trim().toLowerCase() === opt.trim().toLowerCase();
                  const optLetter = String.fromCharCode(65 + oIdx);

                  return (
                    <button
                      key={oIdx}
                      type="button"
                      onClick={(e) => {
                        createRipple(e);
                        handleTextAnswerChange(currentQuestion.id, opt);
                      }}
                      className={`p-3.5 rounded-2xl border text-left flex items-start space-x-3 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#E0F8F3] border-[#00A99D] ring-2 ring-[#00A99D]/40 shadow-xs'
                          : 'bg-white border-[#E0EBF4] hover:border-[#00A99D]/40'
                      }`}
                    >
                      <span className={`w-6 h-6 rounded-lg font-bold flex items-center justify-center shrink-0 text-xs ${
                        isSelected ? 'bg-[#00A99D] text-white' : 'bg-[#EAF6FF] text-[#1E65B5]'
                      }`}>
                        {optLetter}
                      </span>
                      <span className={`text-xs sm:text-sm leading-relaxed ${
                        isSelected ? 'text-[#007F76] font-bold' : 'text-[#102A43]'
                      }`}>
                        {opt}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Text input for essay or extra detail */}
          {(!currentQuestion.options || currentQuestion.options.length === 0) && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-[#102A43] flex items-center space-x-1.5">
                <PenTool className="w-3.5 h-3.5 text-[#00A99D]" />
                <span>Gõ câu trả lời của em:</span>
              </label>
              <textarea
                value={userAnswers[currentQuestion.id] || ''}
                onChange={(e) => handleTextAnswerChange(currentQuestion.id, e.target.value)}
                placeholder="Gõ câu trả lời của em vào đây..."
                rows={4}
                className="w-full p-4 text-xs sm:text-sm rounded-2xl border border-[#E0EBF4] focus:outline-none focus:border-[#00A99D] bg-[#F4FAFF] leading-relaxed font-sans text-[#102A43]"
              />
            </div>
          )}

          {/* Hint & Locked SGK toggle */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E0EBF4]">
            <div className="flex items-center space-x-2 text-xs">
              <button
                type="button"
                onClick={() => setShowHint(prev => ({ ...prev, [currentQuestion.id]: !prev[currentQuestion.id] }))}
                className="text-[#8A5800] bg-[#FFF8E7] px-3 py-1.5 rounded-xl font-bold border border-[#F2B544]/40"
              >
                {showHint[currentQuestion.id] ? 'Ẩn gợi ý' : '💡 Xem gợi ý'}
              </button>

              <span className="inline-flex items-center space-x-1.5 text-[#61758A] bg-[#F4FAFF] px-3 py-1.5 rounded-xl font-medium border border-[#E0EBF4] text-xs cursor-not-allowed select-none">
                <Lock className="w-3.5 h-3.5 text-[#61758A]" />
                <span>Đáp án SGK (Chỉ mở sau khi nộp bài)</span>
              </span>
            </div>
          </div>

          {showHint[currentQuestion.id] && (
            <div className="p-3.5 bg-[#FFF8E7] rounded-2xl border border-[#FCE1A8] text-xs text-[#8A5800] space-y-1">
              <p className="font-bold flex items-center space-x-1">
                <Lightbulb className="w-3.5 h-3.5 text-[#D97706]" />
                <span>Gợi ý định hướng:</span>
              </p>
              <p className="leading-relaxed pl-5 font-medium">{currentQuestion.hint || 'Đọc kỹ lại văn bản để tìm chi tiết.'}</p>
            </div>
          )}

          {/* Step Navigation & Submission */}
          <div className="flex items-center justify-between border-t border-[#E0EBF4] pt-4">
            <button
              onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
              disabled={currentIndex === 0}
              className="text-xs font-bold text-[#61758A] disabled:opacity-30 hover:text-[#102A43] cursor-pointer"
            >
              &larr; Câu trước
            </button>

            <div className="flex items-center space-x-2">
              {currentIndex < questions.length - 1 ? (
                <button
                  onClick={() => setCurrentIndex(prev => prev + 1)}
                  className="inline-flex items-center space-x-1.5 bg-[#102A43] hover:bg-[#243B53] text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all"
                >
                  <span>Câu tiếp theo</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={handleSubmitQuiz}
                  className={`inline-flex items-center space-x-1.5 text-white px-6 py-2.5 rounded-xl text-xs font-bold shadow-md cursor-pointer transition-all ${
                    isAllAnswered ? 'btn-primary-teal hover:scale-105' : 'bg-stone-400 hover:bg-stone-500'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Nộp bài & Chấm điểm toàn diện</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
