import React, { useState, useEffect, useRef } from 'react';
import { TextItem, VocabularyItem } from '../types';
import { getPoemAnalysis } from '../data/poetryKnowledge';
import { 
  BookOpen, 
  Sparkles, 
  Maximize2, 
  Minimize2, 
  Type, 
  Volume2, 
  VolumeX, 
  Play, 
  Pause, 
  RotateCcw, 
  HelpCircle, 
  Feather, 
  Music, 
  Compass, 
  Heart, 
  Layers, 
  Eye, 
  Info,
  ChevronRight,
  Bookmark,
  Loader2,
  CheckCircle,
  BookCheck
} from 'lucide-react';
import { createRipple } from '../utils/interactiveEffects';
import confetti from 'canvas-confetti';

interface PoetryReaderProps {
  text: TextItem;
  onGoToQuiz: () => void;
  onSelectWord?: (vocab: VocabularyItem) => void;
}

export const PoetryReader: React.FC<PoetryReaderProps> = ({
  text,
  onGoToQuiz,
  onSelectWord
}) => {
  // Mode: 'reading' (Đọc nguyên tác - Mặc định) or 'analysis' (Phân tích & Cảm thụ)
  const [mode, setMode] = useState<'reading' | 'analysis'>('reading');

  // Font size: 'normal' (19px), 'large' (21px), 'xlarge' (24px)
  const [fontSize, setFontSize] = useState<'normal' | 'large' | 'xlarge'>('normal');

  // Focus mode (ẩn bớt các chi tiết xung quanh, toàn tâm vào trang thơ)
  const [isFocusMode, setIsFocusMode] = useState(false);

  // Guide rhythm indicator (Hiển thị ngắt nhịp thanh nhã)
  const [showRhythmMarks, setShowRhythmMarks] = useState(false);

  // Interactive selected line / stanza for analysis mode
  const [selectedStanzaIndex, setSelectedStanzaIndex] = useState<number>(0);
  const [selectedLineIndex, setSelectedLineIndex] = useState<number | null>(null);

  // Audio / TTS State - Standard Northern Vietnamese Female Voice (Hà Nội chuẩn)
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isPausedAudio, setIsPausedAudio] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [activeSpeakingLineIdx, setActiveSpeakingLineIdx] = useState<number>(-1);
  const [activeSpeakingStanzaIdx, setActiveSpeakingStanzaIdx] = useState<number>(-1);

  // Reading Progress State for Poems
  const [readingProgress, setReadingProgress] = useState(0);
  const poemPaperRef = useRef<HTMLDivElement | null>(null);

  // Audio Queue & Preloading refs to guarantee seamless, uninterrupted poem recitation
  const audioCacheRef = useRef<Map<number, HTMLAudioElement>>(new Map());
  const preloadingPromisesRef = useRef<Map<number, Promise<HTMLAudioElement | null>>>(new Map());
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const nextStanzaTimerRef = useRef<any>(null);
  const isPlayingRef = useRef<boolean>(false);
  const currentStanzaIdxRef = useRef<number>(-1);

  // Analysis data computed for this poem
  const analysis = React.useMemo(() => getPoemAnalysis(text), [text]);

  // Clean lines for TTS and line tracking
  const allLines = React.useMemo(() => {
    return text.content.split('\n');
  }, [text.content]);

  // Split content into stanzas
  const stanzas = React.useMemo(() => {
    const rawStanzas: { lines: { text: string; globalIdx: number }[] }[] = [];
    let current: { text: string; globalIdx: number }[] = [];

    allLines.forEach((l, idx) => {
      if (l.trim().length === 0) {
        if (current.length > 0) {
          rawStanzas.push({ lines: current });
          current = [];
        }
      } else {
        current.push({ text: l, globalIdx: idx });
      }
    });

    if (current.length > 0) {
      rawStanzas.push({ lines: current });
    }

    return rawStanzas;
  }, [allLines]);

  // Reset audio cache and stop playback when text changes
  useEffect(() => {
    handleStopPoem();
    audioCacheRef.current.clear();
    preloadingPromisesRef.current.clear();
    setReadingProgress(0);
  }, [text.id]);

  // Track poem reading progress through scrolling and/or stanza recitation
  useEffect(() => {
    const calculateProgress = () => {
      const el = poemPaperRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const totalHeight = rect.height;
      if (totalHeight <= 0) return;

      const scrolled = Math.max(0, -rect.top + 160);
      const scrollableRange = Math.max(1, totalHeight - windowHeight * 0.45);
      const scrollPct = Math.min(100, Math.max(0, Math.round((scrolled / scrollableRange) * 100)));

      let audioPct = 0;
      if (activeSpeakingStanzaIdx >= 0 && stanzas.length > 0) {
        audioPct = Math.min(100, Math.round(((activeSpeakingStanzaIdx + 1) / stanzas.length) * 100));
      }

      const currentPct = Math.max(scrollPct, audioPct);
      setReadingProgress(prev => Math.min(100, Math.max(prev, currentPct)));
    };

    window.addEventListener('scroll', calculateProgress, { passive: true });
    calculateProgress();
    return () => window.removeEventListener('scroll', calculateProgress);
  }, [text.id, activeSpeakingStanzaIdx, stanzas.length]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.src = '';
        currentAudioRef.current = null;
      }
      if (nextStanzaTimerRef.current) {
        clearTimeout(nextStanzaTimerRef.current);
      }
      audioCacheRef.current.clear();
      preloadingPromisesRef.current.clear();
    };
  }, []);

  // Preload and cache a stanza's audio buffer
  const loadStanzaAudio = async (stanzaIdx: number, retryCount = 0): Promise<HTMLAudioElement | null> => {
    if (stanzaIdx < 0 || stanzaIdx >= stanzas.length) return null;

    if (audioCacheRef.current.has(stanzaIdx)) {
      return audioCacheRef.current.get(stanzaIdx)!;
    }

    if (preloadingPromisesRef.current.has(stanzaIdx)) {
      return preloadingPromisesRef.current.get(stanzaIdx)!;
    }

    const promise = (async () => {
      const currentStanza = stanzas[stanzaIdx];
      const stanzaText = currentStanza.lines.map(l => l.text).join('\n');

      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: stanzaText,
            isPoem: true,
            preferEngine: 'hanoi-female'
          })
        });

        if (!res.ok) {
          throw new Error(`TTS server response error: ${res.status}`);
        }

        const data = await res.json();
        if (!data.audioBase64) {
          throw new Error('No audio data received in response');
        }

        const audio = new Audio(`data:${data.mimeType || 'audio/mpeg'};base64,${data.audioBase64}`);
        audio.preload = 'auto';
        audio.playbackRate = 0.94; // Lyrical poetic pacing

        audioCacheRef.current.set(stanzaIdx, audio);
        return audio;
      } catch (err) {
        console.warn(`Lỗi tải giọng đọc khổ ${stanzaIdx + 1}:`, err);
        if (retryCount < 2) {
          await new Promise(r => setTimeout(r, 600));
          return loadStanzaAudio(stanzaIdx, retryCount + 1);
        }
        return null;
      } finally {
        preloadingPromisesRef.current.delete(stanzaIdx);
      }
    })();

    preloadingPromisesRef.current.set(stanzaIdx, promise);
    return promise;
  };

  // Preload next 1-2 stanzas in the background while current stanza is playing
  const preloadNextStanzas = (fromIdx: number) => {
    if (fromIdx + 1 < stanzas.length) {
      loadStanzaAudio(fromIdx + 1);
    }
    if (fromIdx + 2 < stanzas.length) {
      loadStanzaAudio(fromIdx + 2);
    }
  };

  // Play a specific stanza and smoothly chain to subsequent stanzas until the poem finishes
  const playStanza = async (stanzaIdx: number) => {
    if (stanzaIdx >= stanzas.length) {
      // Reached the end of the poem!
      handleStopPoem();
      try {
        confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
      } catch {}
      return;
    }

    // Stop and cleanup any currently active audio instance to avoid overlapping streams
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.onended = null;
      currentAudioRef.current.ontimeupdate = null;
      currentAudioRef.current.onerror = null;
      currentAudioRef.current = null;
    }
    if (nextStanzaTimerRef.current) {
      clearTimeout(nextStanzaTimerRef.current);
      nextStanzaTimerRef.current = null;
    }

    isPlayingRef.current = true;
    setIsPlayingAudio(true);
    setIsPausedAudio(false);
    currentStanzaIdxRef.current = stanzaIdx;
    setActiveSpeakingStanzaIdx(stanzaIdx);

    const currentStanza = stanzas[stanzaIdx];
    if (currentStanza.lines.length > 0) {
      setActiveSpeakingLineIdx(currentStanza.lines[0].globalIdx);
    }

    // Preload ahead in the background for zero-latency transition
    preloadNextStanzas(stanzaIdx);

    // Retrieve or fetch audio for this stanza
    let audio = audioCacheRef.current.get(stanzaIdx) || null;
    if (!audio) {
      setIsLoadingAudio(true);
      audio = await loadStanzaAudio(stanzaIdx);
      setIsLoadingAudio(false);
    }

    // Check if user stopped or changed stanza while downloading
    if (!isPlayingRef.current || currentStanzaIdxRef.current !== stanzaIdx) {
      return;
    }

    if (!audio) {
      setIsPlayingAudio(false);
      setIsPausedAudio(false);
      isPlayingRef.current = false;
      setVoiceNotice('Không thể tải giọng đọc lúc này. Em hãy bấm vào biểu tượng loa để thử lại nhé!');
      return;
    }

    currentAudioRef.current = audio;
    audio.currentTime = 0;

    // Track audio time and highlight active line in the stanza
    audio.ontimeupdate = () => {
      if (audio && audio.duration > 0 && currentStanza.lines.length > 1) {
        const ratio = audio.currentTime / audio.duration;
        const lineOffset = Math.min(
          currentStanza.lines.length - 1,
          Math.floor(ratio * currentStanza.lines.length)
        );
        setActiveSpeakingLineIdx(currentStanza.lines[lineOffset].globalIdx);
      }
    };

    // When current stanza completes: transition to next stanza after a natural poetic pause
    audio.onended = () => {
      audio.onended = null;
      audio.ontimeupdate = null;
      audio.onerror = null;

      if (!isPlayingRef.current) return;

      const nextStanzaIdx = stanzaIdx + 1;
      if (nextStanzaIdx < stanzas.length) {
        // Natural 0.8s lyrical breathing pause between stanzas
        nextStanzaTimerRef.current = setTimeout(() => {
          if (isPlayingRef.current) {
            playStanza(nextStanzaIdx);
          }
        }, 800);
      } else {
        // Entire poem successfully recited from beginning to end!
        setIsPlayingAudio(false);
        isPlayingRef.current = false;
        setIsPausedAudio(false);
        setActiveSpeakingLineIdx(-1);
        setActiveSpeakingStanzaIdx(-1);
        currentAudioRef.current = null;
        try {
          confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
        } catch {}
      }
    };

    audio.onerror = (e) => {
      console.warn(`Lỗi phát audio khổ ${stanzaIdx + 1}:`, e);
      setIsPlayingAudio(false);
      setIsPausedAudio(false);
      isPlayingRef.current = false;
      setVoiceNotice('Quá trình phát giọng đọc bị gián đoạn. Em hãy bấm vào biểu tượng loa để thử lại nhé!');
    };

    try {
      await audio.play();
      setIsPlayingAudio(true);
      setIsPausedAudio(false);
    } catch (playErr) {
      console.warn('Audio play() call was interrupted:', playErr);
    }
  };

  // Main playback controls
  const handlePlayPoem = (stanzaIdx = 0) => {
    handleStopPoem();
    playStanza(stanzaIdx);
  };

  const handlePausePoem = () => {
    if (currentAudioRef.current && isPlayingAudio) {
      currentAudioRef.current.pause();
      setIsPausedAudio(true);
    }
    if (nextStanzaTimerRef.current) {
      clearTimeout(nextStanzaTimerRef.current);
      nextStanzaTimerRef.current = null;
    }
  };

  const handleResumePoem = () => {
    if (currentAudioRef.current && isPausedAudio) {
      currentAudioRef.current.play().catch(console.warn);
      setIsPausedAudio(false);
    } else if (currentStanzaIdxRef.current >= 0) {
      playStanza(currentStanzaIdxRef.current);
    } else {
      handlePlayPoem(0);
    }
  };

  const handleStopPoem = () => {
    isPlayingRef.current = false;
    currentStanzaIdxRef.current = -1;

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.onended = null;
      currentAudioRef.current.ontimeupdate = null;
      currentAudioRef.current.onerror = null;
      currentAudioRef.current = null;
    }
    if (nextStanzaTimerRef.current) {
      clearTimeout(nextStanzaTimerRef.current);
      nextStanzaTimerRef.current = null;
    }

    setIsPlayingAudio(false);
    setIsPausedAudio(false);
    setIsLoadingAudio(false);
    setActiveSpeakingLineIdx(-1);
    setActiveSpeakingStanzaIdx(-1);
  };

  // Font size class mapping
  const fontSizeStyle = fontSize === 'normal' 
    ? 'text-[19px] sm:text-[20px] leading-[1.85]' 
    : fontSize === 'large' 
    ? 'text-[21px] sm:text-[22px] leading-[1.9]' 
    : 'text-[23px] sm:text-[25px] leading-[1.95]';

  // Format line with subtle poetic rhythm mark if enabled
  const renderLineText = (lineText: string, globalLineIdx: number) => {
    if (!showRhythmMarks) {
      return <span>{lineText}</span>;
    }

    // Gentle rhythm split: for 5-syllable, split 2/3 or 3/2; for 4-syllable 2/2; 7/8 syllable
    const words = lineText.trim().split(/\s+/);
    if (words.length === 5) {
      // 2/3 split
      return (
        <span>
          {words.slice(0, 2).join(' ')}
          <span className="text-amber-500/70 font-bold px-1 select-none text-[15px] italic">/</span>
          {words.slice(2).join(' ')}
        </span>
      );
    } else if (words.length === 4) {
      // 2/2 split
      return (
        <span>
          {words.slice(0, 2).join(' ')}
          <span className="text-amber-500/70 font-bold px-1 select-none text-[15px] italic">/</span>
          {words.slice(2).join(' ')}
        </span>
      );
    } else if (words.length === 6) {
      // 2/2/2 or 3/3 split
      return (
        <span>
          {words.slice(0, 2).join(' ')}
          <span className="text-amber-500/70 font-bold px-1 select-none text-[15px] italic">/</span>
          {words.slice(2, 4).join(' ')}
          <span className="text-amber-500/70 font-bold px-1 select-none text-[15px] italic">/</span>
          {words.slice(4).join(' ')}
        </span>
      );
    } else if (words.length === 8) {
      // 4/4 or 2/2/2/2 split
      return (
        <span>
          {words.slice(0, 4).join(' ')}
          <span className="text-amber-500/70 font-bold px-1 select-none text-[15px] italic">/</span>
          {words.slice(4).join(' ')}
        </span>
      );
    } else if (words.length === 7) {
      // 4/3 split
      return (
        <span>
          {words.slice(0, 4).join(' ')}
          <span className="text-amber-500/70 font-bold px-1 select-none text-[15px] italic">/</span>
          {words.slice(4).join(' ')}
        </span>
      );
    }

    return <span>{lineText}</span>;
  };

  const isExcerpt = text.isExcerpt || 
    text.title.toLowerCase().includes('trích') || 
    text.authorOrSource.toLowerCase().includes('trích') ||
    text.excerpt.toLowerCase().includes('trích');

  return (
    <div className={`transition-all duration-300 ${isFocusMode ? 'fixed inset-0 z-50 bg-[#FAF7F2] overflow-y-auto p-4 sm:p-8' : 'space-y-6'}`}>
      {/* ================= TOP CONTROLS & MODE SWITCHER ================= */}
      <div className="bg-white rounded-2xl p-3 sm:p-4 border border-[#E0EBF4] shadow-xs flex flex-wrap items-center justify-between gap-3">
        {/* Mode Switcher: Đọc nguyên tác vs Phân tích & Cảm thụ */}
        <div className="flex items-center bg-[#F4FAFF] p-1 rounded-xl border border-[#E0EBF4] text-xs font-bold">
          <button
            onClick={(e) => {
              createRipple(e);
              setMode('reading');
            }}
            className={`px-3 sm:px-4 py-2 rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer ${
              mode === 'reading'
                ? 'bg-[#00A99D] text-white shadow-xs'
                : 'text-[#61758A] hover:text-[#102A43]'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Đọc nguyên tác</span>
          </button>

          <button
            onClick={(e) => {
              createRipple(e);
              setMode('analysis');
            }}
            className={`px-3 sm:px-4 py-2 rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer ${
              mode === 'analysis'
                ? 'bg-[#7C3AED] text-white shadow-xs'
                : 'text-[#61758A] hover:text-[#102A43]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Phân tích & Cảm thụ</span>
          </button>
        </div>

        {/* Reading Tools Toolbar */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          {/* Rhythm Toggle */}
          <button
            onClick={() => setShowRhythmMarks(!showRhythmMarks)}
            className={`px-3 py-1.5 rounded-xl border transition-all flex items-center space-x-1.5 cursor-pointer ${
              showRhythmMarks
                ? 'bg-amber-50 text-amber-900 border-amber-300 shadow-2xs font-bold'
                : 'bg-white text-[#61758A] border-[#E0EBF4] hover:bg-[#F4FAFF]'
            }`}
            title="Bật/tắt ký hiệu ngắt nhịp thơ nhẹ nhàng"
          >
            <Music className="w-3.5 h-3.5 text-amber-600" />
            <span className="hidden sm:inline">{showRhythmMarks ? 'Đang hiện ngắt nhịp' : 'Hướng dẫn ngắt nhịp'}</span>
          </button>

          {/* Font Size Adjuster */}
          <div className="flex items-center bg-[#F4FAFF] border border-[#E0EBF4] rounded-xl p-0.5">
            <span className="px-1.5 text-[11px] text-[#61758A] font-bold">Cỡ chữ:</span>
            <button
              onClick={() => setFontSize('normal')}
              className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${fontSize === 'normal' ? 'bg-[#00A99D] text-white font-bold' : 'text-[#61758A] hover:bg-white'}`}
            >
              A
            </button>
            <button
              onClick={() => setFontSize('large')}
              className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${fontSize === 'large' ? 'bg-[#00A99D] text-white font-bold' : 'text-[#61758A] hover:bg-white'}`}
            >
              A+
            </button>
            <button
              onClick={() => setFontSize('xlarge')}
              className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${fontSize === 'xlarge' ? 'bg-[#00A99D] text-white font-bold' : 'text-[#61758A] hover:bg-white'}`}
            >
              A++
            </button>
          </div>

          {/* Standardized Northern Hanoi Female Voice Badge */}
          <div className="flex items-center bg-gradient-to-r from-[#E0F8F3] to-[#EAF6FF] border border-[#BDE8E0] rounded-xl px-3 py-1.5 gap-1.5 shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-bold text-[#007F76] flex items-center space-x-1">
              <span>🌸 Nữ Hà Nội chuẩn</span>
              <span className="text-[11px] text-[#007F76]/80 font-medium">· Truyền cảm</span>
            </span>
          </div>

          {/* Text-to-Speech Poetic Reading Controls */}
          {isLoadingAudio ? (
            <div className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold flex items-center space-x-1.5 shadow-2xs animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
              <span>Đang tải giọng đọc...</span>
            </div>
          ) : !isPlayingAudio ? (
            <button
              onClick={() => handlePlayPoem(0)}
              className="px-3.5 py-1.5 rounded-xl bg-[#00A99D] hover:bg-[#008F85] text-white transition-all flex items-center space-x-1.5 cursor-pointer font-bold shadow-xs active:scale-95"
              title="Nghe cô giáo đọc toàn bộ bài thơ từ đầu đến cuối bằng Giọng Nữ Hà Nội chuẩn"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>Nghe đọc toàn bài</span>
            </button>
          ) : (
            <div className="flex items-center space-x-2 bg-[#E0F8F3] border border-[#BDE8E0] px-3 py-1.5 rounded-xl shadow-xs">
              <div className="text-xs font-bold text-[#007F76] pr-1 flex items-center gap-1.5">
                <span className="flex items-center space-x-0.5 h-3.5">
                  <span className="w-1 h-3 bg-[#00A99D] rounded-full animate-wave-1"></span>
                  <span className="w-1 h-4 bg-[#00A99D] rounded-full animate-wave-3"></span>
                  <span className="w-1 h-2 bg-[#00A99D] rounded-full animate-wave-2"></span>
                </span>
                <span>{activeSpeakingStanzaIdx >= 0 ? `Khổ ${activeSpeakingStanzaIdx + 1}/${stanzas.length}` : 'Đang đọc'}</span>
              </div>
              {isPausedAudio ? (
                <button
                  onClick={handleResumePoem}
                  className="p-1.5 rounded-lg text-[#00A99D] hover:bg-white transition-colors cursor-pointer"
                  title="Tiếp tục nghe"
                >
                  <Play className="w-4 h-4 fill-current" />
                </button>
              ) : (
                <button
                  onClick={handlePausePoem}
                  className="p-1.5 rounded-lg text-[#00A99D] hover:bg-white transition-colors cursor-pointer"
                  title="Tạm dừng"
                >
                  <Pause className="w-4 h-4 fill-current" />
                </button>
              )}
              <button
                onClick={handleStopPoem}
                className="p-1.5 rounded-lg text-rose-600 hover:bg-white transition-colors cursor-pointer"
                title="Dừng đọc"
              >
                <VolumeX className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Focus Mode Toggle */}
          <button
            onClick={() => setIsFocusMode(!isFocusMode)}
            className={`p-2 rounded-xl border transition-all cursor-pointer ${
              isFocusMode
                ? 'bg-[#102A43] text-white border-[#102A43]'
                : 'bg-white text-[#61758A] border-[#E0EBF4] hover:bg-[#F4FAFF]'
            }`}
            title={isFocusMode ? 'Thoát chế độ tập trung' : 'Chế độ tập trung (Tĩnh lặng đọc thơ)'}
          >
            {isFocusMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Go to Quiz Shortcut */}
          <button
            onClick={onGoToQuiz}
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-teal-600 to-teal-700 hover:from-teal-700 hover:to-teal-800 text-white font-bold transition-all shadow-xs flex items-center space-x-1.5 cursor-pointer ml-auto"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Câu hỏi đọc hiểu</span>
          </button>
        </div>
      </div>

      {/* Sticky Top Mini Progress Bar for poem reading */}
      {readingProgress > 0 && (
        <div className="fixed top-0 left-0 right-0 h-1.5 bg-[#EDE4D6]/90 z-50 pointer-events-none">
          <div
            className="h-full bg-gradient-to-r from-[#00A99D] via-[#3285E8] to-[#00A99D] transition-all duration-150 shadow-xs"
            style={{ width: `${readingProgress}%` }}
          />
        </div>
      )}

      {/* Voice Notification Banner */}
      {voiceNotice && (
        <div className="bg-amber-50/95 border border-amber-200 text-amber-900 rounded-2xl px-4 py-2.5 text-xs flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center space-x-2">
            <Info className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{voiceNotice}</span>
          </div>
          <button
            onClick={() => setVoiceNotice(null)}
            className="text-amber-700 hover:text-amber-900 font-bold px-2 py-0.5 rounded-lg hover:bg-amber-100 cursor-pointer"
          >
            Đã hiểu
          </button>
        </div>
      )}

      {/* ================= POETIC AUDIO CONTROLLER BAR ================= */}
      <div className="bg-white rounded-2xl p-3.5 sm:p-4 border border-[#E0EBF4] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#E0F8F3] to-[#EAF6FF] text-[#00A99D] flex items-center justify-center font-bold shadow-2xs shrink-0">
            <Music className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-sm text-[#102A43]">Nghe ngâm thơ & Đọc diễn cảm</span>
              <span className="text-[10px] bg-[#E0F8F3] text-[#007F76] font-bold px-2 py-0.5 rounded-full border border-[#BDE8E0]">
                {stanzas.length} khổ thơ
              </span>
              <span className="text-[10px] bg-rose-50 text-rose-700 font-bold px-2 py-0.5 rounded-full border border-rose-200 hidden sm:inline">
                🌸 Nữ Hà Nội chuẩn
              </span>
            </div>
            <p className="text-xs text-[#61758A] mt-0.5">
              {isPlayingAudio ? (
                <span className="text-[#007F76] font-bold flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#00A99D] animate-ping"></span>
                  <span>
                    Đang đọc khổ {activeSpeakingStanzaIdx + 1}/{stanzas.length} &bull; Tự động chuyển tiếp liền mạch đến hết bài
                  </span>
                </span>
              ) : (
                <span>
                  Phát âm chuẩn giọng Hà Nội, ngắt nhịp câu thơ và nghỉ tự nhiên giữa các khổ thơ.
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Stanza Jump Buttons (1-click to jump to any stanza) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 pt-1 md:pt-0 border-t md:border-t-0 border-[#E0EBF4]">
          <button
            onClick={() => handlePlayPoem(0)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-2xs shrink-0 flex items-center space-x-1 ${
              isPlayingAudio && activeSpeakingStanzaIdx === 0
                ? 'bg-[#00A99D] text-white shadow-xs ring-2 ring-[#00A99D]/30'
                : 'bg-[#F4FAFF] hover:bg-[#E0F8F3] text-[#007F76] border border-[#BDE8E0]'
            }`}
            title="Đọc liên tục toàn bài từ khổ đầu tiên"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>Đọc từ đầu</span>
          </button>

          {stanzas.map((_, sIdx) => {
            const isCurrentStanza = isPlayingAudio && activeSpeakingStanzaIdx === sIdx;
            return (
              <button
                key={sIdx}
                onClick={() => handlePlayPoem(sIdx)}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
                  isCurrentStanza
                    ? 'bg-[#00A99D] text-white shadow-xs ring-2 ring-[#00A99D]/30'
                    : 'bg-[#FAF7F2] hover:bg-[#EAF6FF] text-[#61758A] hover:text-[#102A43] border border-[#E0EBF4]'
                }`}
                title={`Nghe từ khổ ${sIdx + 1} đến hết bài`}
              >
                Khổ {sIdx + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* ================= MAIN CONTENT: BOOK PAGE LAYOUT ================= */}
      <div className={`transition-all duration-300 ${mode === 'analysis' ? 'grid grid-cols-1 lg:grid-cols-12 gap-6 items-start' : 'max-w-[760px] mx-auto'}`}>
        
        {/* POEM BOOK PAGE (Electronic Literary Page) */}
        <div ref={poemPaperRef} className={`bg-[#FAF7F2] rounded-3xl border border-[#EDE4D6] shadow-sm p-6 sm:p-12 relative overflow-hidden ${
          mode === 'analysis' ? 'lg:col-span-7 xl:col-span-8' : 'w-full'
        }`}>
          {/* Subtle Book Spine & Watermark Ornament */}
          <div className="absolute top-0 left-0 bottom-0 w-2.5 bg-gradient-to-r from-[#D7C9B1] to-transparent pointer-events-none opacity-40"></div>
          <div className="absolute top-4 right-5 text-[#C4B59D]/30 pointer-events-none select-none">
            <Bookmark className="w-10 h-10 stroke-[1]" />
          </div>

          {/* ================= READING PROGRESS BAR ================= */}
          <div className="bg-gradient-to-r from-[#F5EFE6] via-white to-[#E0F8F3] p-4 rounded-2xl border border-[#E3D6C1] shadow-2xs space-y-2.5 mb-7 relative z-10">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#00A99D] to-[#008F85] text-white flex items-center justify-center shadow-xs shrink-0">
                  <BookCheck className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-extrabold text-[#2C2115] text-xs sm:text-sm">Tiến độ đọc thơ</span>
                    <span className="text-[10px] bg-white text-[#007F76] font-bold px-2 py-0.5 rounded-full border border-[#BDE8E0]">
                      Trực quan %
                    </span>
                  </div>
                  <p className="text-[#8A7965] text-[11px] font-medium hidden sm:block">
                    {readingProgress >= 100 
                      ? '🎉 Chúc mừng em đã hoàn thành 100% nội dung bài thơ!' 
                      : 'Cuộn trang hoặc bấm "Nghe đọc toàn bài" để thưởng thức'}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                {readingProgress >= 100 ? (
                  <span className="inline-flex items-center space-x-1.5 bg-emerald-100 text-emerald-800 border border-emerald-300 px-3 py-1 rounded-full text-xs font-black shadow-2xs animate-in zoom-in-95">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span>100% Hoàn thành</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center space-x-1 bg-white text-[#007F76] border border-[#BDE8E0] px-3 py-1 rounded-full text-xs font-black shadow-2xs">
                    <span className="text-sm text-[#00A99D]">{readingProgress}%</span>
                    <span className="text-[11px] text-[#61758A] font-semibold">đã đọc</span>
                  </span>
                )}
              </div>
            </div>

            {/* Progress Bar Track with Gradient Fill */}
            <div className="w-full h-3 bg-[#EAE0D0] rounded-full overflow-hidden p-0.5 shadow-inner relative">
              <div
                className="h-full rounded-full transition-all duration-300 ease-out bg-gradient-to-r from-[#00A99D] via-[#3285E8] to-[#00A99D] relative overflow-hidden"
                style={{ width: `${Math.max(readingProgress, 4)}%` }}
              >
                <div className="absolute inset-0 bg-white/25 -skew-x-12 animate-pulse" />
              </div>
            </div>

            {/* Milestone Checkpoints */}
            <div className="flex justify-between text-[10px] text-[#8A7965] px-1 font-semibold">
              <span className={readingProgress >= 0 ? 'text-[#00A99D] font-bold' : ''}>0%</span>
              <span className={readingProgress >= 25 ? 'text-[#00A99D] font-bold' : ''}>25%</span>
              <span className={readingProgress >= 50 ? 'text-[#00A99D] font-bold' : ''}>50%</span>
              <span className={readingProgress >= 75 ? 'text-[#00A99D] font-bold' : ''}>75%</span>
              <span className={readingProgress >= 100 ? 'text-emerald-700 font-bold' : ''}>100% Hoàn tất</span>
            </div>
          </div>

          {/* Sticky Top Mini Progress Bar when scrolling */}
          {readingProgress > 0 && (
            <div className="fixed top-0 left-0 right-0 h-1.5 bg-[#E0EBF4]/80 z-50 pointer-events-none">
              <div
                className="h-full bg-gradient-to-r from-[#00A99D] via-[#3285E8] to-[#00A99D] transition-all duration-150 shadow-xs"
                style={{ width: `${readingProgress}%` }}
              />
            </div>
          )}

          {/* A. THÔNG TIN TÁC PHẨM */}
          <div className="border-b border-[#E8DEC9] pb-6 mb-8 text-center space-y-3 relative z-10">
            {/* Badges: Thể thơ, Khối lớp, Trích đoạn */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="px-3 py-1 rounded-full bg-[#EFE7D8] text-[#6E5936] text-xs font-bold border border-[#DFD3BE]">
                {analysis.poeticForm}
              </span>
              <span className="px-3 py-1 rounded-full bg-[#E0F8F3] text-[#007F76] text-xs font-bold border border-[#BDE8E0]">
                {text.unit} (Lớp {text.grade})
              </span>
              {isExcerpt && (
                <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold border border-amber-300">
                  Trích đoạn tác phẩm
                </span>
              )}
            </div>

            {/* Tên bài thơ (Modern Academic Serif) */}
            <h1 className="font-serif-academic text-2xl sm:text-4xl font-extrabold text-[#2C2115] tracking-tight">
              {text.title}
            </h1>

            {/* Tác giả & Nguồn xuất xứ */}
            <div className="space-y-1">
              <p className="font-serif-academic text-sm sm:text-base italic text-[#5C4D3C] font-semibold flex items-center justify-center space-x-1.5">
                <Feather className="w-4 h-4 text-[#C07D2B]" />
                <span>Tác giả: {text.authorOrSource}</span>
              </p>
              <p className="text-xs text-[#8A7965]">
                {analysis.sourceOrigin}
              </p>
            </div>
          </div>

          {/* B. NỘI DUNG BÀI THƠ (Hiển thị đầy đủ, đúng khổ, căn trái tao nhã, không cắt xén) */}
          <div className="relative z-10 max-w-[620px] mx-auto">
            {mode === 'analysis' && (
              <div className="mb-4 p-3 bg-purple-50/80 rounded-xl border border-purple-200 text-xs text-purple-900 flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-purple-600 shrink-0" />
                <span>
                  <strong>Chế độ Cảm thụ:</strong> Em có thể nhấp chuột vào bất kỳ khổ thơ hoặc câu thơ nào để xem phân tích nghệ thuật chi tiết bên phải.
                </span>
              </div>
            )}

            <div className="space-y-6 sm:space-y-7 font-serif-academic text-[#231B12]">
              {stanzas.map((stanza, sIdx) => {
                const isStanzaSelected = mode === 'analysis' && selectedStanzaIndex === sIdx;

                return (
                  <div
                    key={sIdx}
                    onClick={() => {
                      if (mode === 'analysis') {
                        setSelectedStanzaIndex(sIdx);
                        setSelectedLineIndex(null);
                      }
                    }}
                    className={`group p-3 sm:p-4 rounded-2xl transition-all ${
                      activeSpeakingStanzaIdx === sIdx
                        ? 'bg-[#FAF2E3]/80 ring-1 ring-amber-300/90 shadow-2xs'
                        : mode === 'analysis'
                        ? isStanzaSelected
                          ? 'bg-white/90 ring-2 ring-[#7C3AED] shadow-sm cursor-pointer'
                          : 'hover:bg-white/60 cursor-pointer'
                        : 'hover:bg-white/40'
                    }`}
                  >
                    {/* Stanza marker for reading vs analysis mode */}
                    {mode === 'reading' ? (
                      <div className="flex items-center justify-between mb-1.5 text-[11px] text-[#8A7965]">
                        <span className="font-serif-academic italic text-[12px] opacity-80 flex items-center space-x-1.5">
                          <span>Khổ {sIdx + 1}</span>
                          {activeSpeakingStanzaIdx === sIdx && isPlayingAudio && (
                            <span className="inline-flex items-center space-x-1 text-[10px] font-bold text-[#007F76] bg-[#E0F8F3] px-2 py-0.5 rounded-full border border-[#BDE8E0]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#00A99D] animate-ping"></span>
                              <span>Đang đọc</span>
                            </span>
                          )}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayPoem(sIdx);
                          }}
                          className={`px-2.5 py-0.5 rounded-lg transition-all cursor-pointer font-bold inline-flex items-center space-x-1 ${
                            activeSpeakingStanzaIdx === sIdx && isPlayingAudio
                              ? 'bg-[#00A99D] text-white shadow-2xs'
                              : 'text-[#007F76] hover:bg-[#E0F8F3] opacity-80 hover:opacity-100'
                          }`}
                          title={`Nghe từ khổ ${sIdx + 1} đến hết bài`}
                        >
                          <Volume2 className="w-3 h-3" />
                          <span>{activeSpeakingStanzaIdx === sIdx && isPlayingAudio ? 'Đang phát' : 'Nghe khổ này'}</span>
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between mb-2 pb-1 border-b border-[#E8DEC9] text-[11px] font-bold text-[#8A7965]">
                        <span>Khổ thơ {sIdx + 1}</span>
                        {isStanzaSelected && (
                          <span className="text-[#7C3AED] flex items-center space-x-1">
                            <span>Đang chọn phân tích</span>
                            <ChevronRight className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                    )}

                    {/* Stanza lines */}
                    <div className={`space-y-1 sm:space-y-1.5 ${fontSizeStyle}`}>
                      {stanza.lines.map((lineObj, lIdx) => {
                        const isSpeaking = activeSpeakingLineIdx === lineObj.globalIdx;
                        const isLineSelected = mode === 'analysis' && selectedLineIndex === lineObj.globalIdx;

                        return (
                          <div
                            key={lIdx}
                            onClick={(e) => {
                              if (mode === 'analysis') {
                                e.stopPropagation();
                                setSelectedStanzaIndex(sIdx);
                                setSelectedLineIndex(lineObj.globalIdx);
                              }
                            }}
                            className={`transition-colors rounded-lg px-2 py-0.5 ${
                              isSpeaking
                                ? 'bg-amber-200/90 font-bold text-[#102A43] ring-1 ring-amber-400/80 shadow-2xs'
                                : isLineSelected
                                ? 'bg-[#EDE7FE] text-[#4C1D95] font-semibold'
                                : ''
                            }`}
                          >
                            {renderLineText(lineObj.text, lineObj.globalIdx)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Note footer */}
            <div className="mt-10 pt-6 border-t border-[#E8DEC9] flex flex-wrap items-center justify-between text-xs text-[#8A7965]">
              <span>Toàn văn bài thơ theo Chương trình GDPT 2018</span>
              <button
                onClick={onGoToQuiz}
                className="text-[#007F76] hover:text-[#005B54] font-bold inline-flex items-center space-x-1 cursor-pointer"
              >
                <span>Luyện câu hỏi đọc hiểu</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* ================= CHẾ ĐỘ 2: BẢNG PHÂN TÍCH & CẢM THỤ (Bên cạnh văn bản) ================= */}
        {mode === 'analysis' && (
          <div className="lg:col-span-5 xl:col-span-4 space-y-5 animate-fade-in">
            {/* Header Card: Central Theme & Main Message */}
            <div className="bg-white rounded-3xl p-5 border border-[#E0EBF4] shadow-xs space-y-4">
              <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-[#7C3AED]">
                <Compass className="w-4 h-4" />
                <span>Chủ đề & Cảm xúc chủ đạo</span>
              </div>

              <div className="space-y-3 text-xs sm:text-sm">
                <div className="p-3 bg-[#F4FAFF] rounded-2xl border border-[#E0EBF4] space-y-1">
                  <span className="font-bold text-[#102A43] flex items-center space-x-1">
                    <Heart className="w-3.5 h-3.5 text-rose-500" />
                    <span>Cảm xúc & Giọng điệu:</span>
                  </span>
                  <p className="text-[#334E68] italic font-serif-academic leading-relaxed">
                    {analysis.tone}
                  </p>
                </div>

                <div className="p-3 bg-[#FAF7F2] rounded-2xl border border-[#EDE4D6] space-y-1">
                  <span className="font-bold text-[#102A43] flex items-center space-x-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span>Thông điệp tác phẩm:</span>
                  </span>
                  <p className="text-[#5C4D3C] font-serif-academic leading-relaxed">
                    {analysis.mainMessage}
                  </p>
                </div>
              </div>
            </div>

            {/* Stanza-by-Stanza Deep Analysis Box */}
            {analysis.stanzas && analysis.stanzas[selectedStanzaIndex] && (
              <div className="bg-white rounded-3xl p-5 border border-[#E0EBF4] shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-[#E0EBF4] pb-3">
                  <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-[#00A99D]">
                    <Layers className="w-4 h-4" />
                    <span>Cảm thụ Khổ thơ {selectedStanzaIndex + 1}</span>
                  </div>
                  <span className="text-[11px] bg-[#E0F8F3] text-[#007F76] font-bold px-2 py-0.5 rounded-full">
                    {analysis.stanzas[selectedStanzaIndex].lines.length} câu thơ
                  </span>
                </div>

                {/* Stanza Content summary */}
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-[#102A43]">Nội dung khổ thơ:</h4>
                  <p className="text-xs sm:text-sm text-[#334E68] leading-relaxed">
                    {analysis.stanzas[selectedStanzaIndex].summary}
                  </p>
                </div>

                {/* Rhythm & Cadence */}
                {analysis.stanzas[selectedStanzaIndex].rhythm && (
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-[#102A43] flex items-center space-x-1">
                      <Music className="w-3.5 h-3.5 text-amber-600" />
                      <span>Nhịp thơ & Âm hưởng:</span>
                    </h4>
                    <p className="text-xs text-[#334E68]">
                      {analysis.stanzas[selectedStanzaIndex].rhythm}
                    </p>
                  </div>
                )}

                {/* Rhetoric Devices */}
                {analysis.stanzas[selectedStanzaIndex].rhetoricDevices && analysis.stanzas[selectedStanzaIndex].rhetoricDevices!.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold text-[#102A43] flex items-center space-x-1">
                      <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                      <span>Biện pháp tu từ đặc sắc:</span>
                    </h4>
                    <ul className="space-y-1 text-xs text-[#334E68]">
                      {analysis.stanzas[selectedStanzaIndex].rhetoricDevices!.map((dev, idx) => (
                        <li key={idx} className="flex items-start space-x-1.5 bg-[#FAF7F2] p-2 rounded-xl border border-[#EDE4D6]">
                          <span className="text-[#00A99D] font-bold">•</span>
                          <span>{dev}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Poetic Images */}
                {analysis.stanzas[selectedStanzaIndex].poeticImages && analysis.stanzas[selectedStanzaIndex].poeticImages!.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold text-[#102A43] flex items-center space-x-1">
                      <Eye className="w-3.5 h-3.5 text-teal-600" />
                      <span>Hình ảnh thơ tiêu biểu:</span>
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.stanzas[selectedStanzaIndex].poeticImages!.map((img, idx) => (
                        <span key={idx} className="px-2.5 py-1 bg-[#EAF6FF] text-[#1E65B5] text-[11px] font-semibold rounded-lg border border-[#C3E4FF]">
                          {img}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Selected line specific highlight note */}
                {selectedLineIndex !== null && (
                  <div className="p-3 bg-[#EDE7FE] rounded-2xl border border-[#DDD0FA] text-xs space-y-1 text-[#2E1065] animate-scale-up">
                    <p className="font-bold flex items-center space-x-1">
                      <span>Câu thơ được chọn:</span>
                    </p>
                    <p className="italic font-serif-academic font-medium">
                      "{allLines[selectedLineIndex]}"
                    </p>
                    <p className="text-[11px] text-[#4C1D95] pt-1">
                      Gợi ý cảm thụ: Hãy chú ý các từ ngữ gợi cảm xúc và cách tác giả tạo nhịp điệu tương phản giữa các hình tượng trong câu thơ này.
                    </p>
                  </div>
                )}

                {/* Stanza pagination buttons */}
                <div className="pt-2 flex items-center justify-between border-t border-[#E0EBF4] text-xs">
                  <button
                    disabled={selectedStanzaIndex === 0}
                    onClick={() => {
                      setSelectedStanzaIndex(prev => Math.max(0, prev - 1));
                      setSelectedLineIndex(null);
                    }}
                    className="px-3 py-1.5 rounded-xl border border-[#E0EBF4] disabled:opacity-30 hover:bg-[#F4FAFF] cursor-pointer"
                  >
                    &larr; Khổ trước
                  </button>
                  <span className="text-[#61758A] font-bold">
                    Khổ {selectedStanzaIndex + 1}/{analysis.stanzas.length}
                  </span>
                  <button
                    disabled={selectedStanzaIndex === analysis.stanzas.length - 1}
                    onClick={() => {
                      setSelectedStanzaIndex(prev => Math.min(analysis.stanzas!.length - 1, prev + 1));
                      setSelectedLineIndex(null);
                    }}
                    className="px-3 py-1.5 rounded-xl border border-[#E0EBF4] disabled:opacity-30 hover:bg-[#F4FAFF] cursor-pointer"
                  >
                    Khổ sau &rarr;
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
