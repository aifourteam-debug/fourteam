import React, { useState, useEffect, useRef } from 'react';
import { TextItem, VocabularyItem } from '../types';
import { useAuth } from '../context/AuthContext';
import { 
  Volume2, 
  VolumeX, 
  Play, 
  Pause, 
  RotateCcw, 
  Mic, 
  MicOff, 
  HelpCircle, 
  Sparkles, 
  BookOpen, 
  Feather, 
  Clock, 
  ChevronRight, 
  Award, 
  CheckCircle, 
  BookCheck, 
  Type, 
  Music, 
  Bot, 
  Info,
  Flame,
  ArrowLeft,
  Columns
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { createRipple } from '../utils/interactiveEffects';
import { QuizSystem } from './QuizSystem';
import { PoetryReader } from './PoetryReader';

interface ReadingViewProps {
  text: TextItem;
  onBack: () => void;
  onGoToQuiz: () => void;
  onOpenAssistantForContext: (prompt: string) => void;
  initialMode?: 'read' | 'voice' | 'quiz';
}

export const ReadingView: React.FC<ReadingViewProps> = ({
  text,
  onBack,
  onGoToQuiz,
  onOpenAssistantForContext,
  initialMode = 'read'
}) => {
  const { user, completeReading, addXP } = useAuth();

  // Active view tab: 'read' (Bài đọc), 'quiz' (Câu hỏi đọc hiểu), or 'split' (Xem song song)
  const [activeTab, setActiveTab] = useState<'read' | 'quiz' | 'split'>(initialMode === 'quiz' ? 'quiz' : 'read');

  // Font size configuration
  const [fontSize, setFontSize] = useState<'normal' | 'large' | 'xlarge'>('normal');
  const [showPoetryRhythms, setShowPoetryRhythms] = useState(true);

  // Active vocabulary modal/popover
  const [selectedWord, setSelectedWord] = useState<VocabularyItem | null>(null);
  const [aiWordExplanation, setAiWordExplanation] = useState<any | null>(null);
  const [loadingWordAi, setLoadingWordAi] = useState(false);

  // ================= TEXT-TO-SPEECH (TTS) STATE =================
  // Authentic Northern Vietnamese Teacher Voices (Hà Nội chuẩn, giàu cảm xúc, truyền cảm)
  const [selectedVoice, setSelectedVoice] = useState<'female' | 'male'>('female');
  const [isLoadingAIVoice, setIsLoadingAIVoice] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isPausedAudio, setIsPausedAudio] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number>(-1);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const aiAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioCacheRef = useRef<Map<number, HTMLAudioElement>>(new Map());
  const preloadingMapRef = useRef<Map<number, Promise<HTMLAudioElement | null>>>(new Map());
  const isPlayingRef = useRef<boolean>(false);

  // Clear cache and restart if voice changes
  const handleVoiceChange = (newVoice: 'female' | 'male') => {
    if (newVoice === selectedVoice) return;
    handleStopAudio();
    audioCacheRef.current.clear();
    preloadingMapRef.current.clear();
    setSelectedVoice(newVoice);
  };

  // Split text into sentences for tracking highlight
  const sentences = React.useMemo(() => {
    if (text.isPoem) {
      return text.content.split('\n').filter(s => s.trim().length > 0);
    }
    const matches = text.content.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g);
    return matches ? matches.map(s => s.trim()).filter(Boolean) : [text.content];
  }, [text]);

  // ================= READING PROGRESS TRACKING =================
  const [readingProgress, setReadingProgress] = useState(0);
  const [hasCelebratedProgress, setHasCelebratedProgress] = useState(false);
  const articleCardRef = useRef<HTMLDivElement | null>(null);

  // Sync completion state with user profile
  useEffect(() => {
    const isCompleted = user?.completedTextIds?.includes(text.id) || false;
    setHasCelebratedProgress(isCompleted);
    setReadingProgress(isCompleted ? 100 : 0);
  }, [text.id, user?.completedTextIds]);

  // Track reading progress through scrolling and/or audio listening
  useEffect(() => {
    const calculateProgress = () => {
      const el = articleCardRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const totalHeight = rect.height;
      if (totalHeight <= 0) return;

      // Start calculating once top enters view
      const scrolled = Math.max(0, -rect.top + 160);
      const scrollableRange = Math.max(1, totalHeight - windowHeight * 0.45);
      const scrollPct = Math.min(100, Math.max(0, Math.round((scrolled / scrollableRange) * 100)));

      // Audio reading progress if teacher voice is active
      let audioPct = 0;
      if (activeSentenceIndex >= 0 && sentences.length > 0) {
        audioPct = Math.min(100, Math.round(((activeSentenceIndex + 1) / sentences.length) * 100));
      }

      const currentEffectivePct = Math.max(scrollPct, audioPct);

      setReadingProgress(prev => {
        const next = Math.min(100, Math.max(prev, currentEffectivePct));
        if (next >= 98 && !hasCelebratedProgress) {
          setHasCelebratedProgress(true);
          try {
            confetti({ particleCount: 35, spread: 50, origin: { y: 0.6 } });
          } catch {}
        }
        return next;
      });
    };

    window.addEventListener('scroll', calculateProgress, { passive: true });
    calculateProgress();
    return () => window.removeEventListener('scroll', calculateProgress);
  }, [text.id, activeSentenceIndex, sentences.length, hasCelebratedProgress]);

  // Clean up audio when unmounting or switching text
  useEffect(() => {
    handleStopAudio();
    audioCacheRef.current.clear();
    preloadingMapRef.current.clear();
  }, [text.id]);

  useEffect(() => {
    return () => {
      if (aiAudioRef.current) {
        aiAudioRef.current.pause();
        aiAudioRef.current.src = '';
        aiAudioRef.current = null;
      }
      audioCacheRef.current.clear();
      preloadingMapRef.current.clear();
    };
  }, []);

  const CHUNK_SIZE = 3;

  // Preload a specific chunk's audio for zero-latency seamless playback
  const loadChunkAudio = async (startIndex: number): Promise<HTMLAudioElement | null> => {
    if (startIndex < 0 || startIndex >= sentences.length) return null;
    if (audioCacheRef.current.has(startIndex)) {
      return audioCacheRef.current.get(startIndex)!;
    }
    if (preloadingMapRef.current.has(startIndex)) {
      return preloadingMapRef.current.get(startIndex)!;
    }

    const chunkSentences = sentences.slice(startIndex, startIndex + CHUNK_SIZE);
    if (chunkSentences.length === 0) return null;

    const promise = (async () => {
      try {
        const textToSpeak = text.isPoem ? chunkSentences.join('\n') : chunkSentences.join(' ');
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: textToSpeak,
            isPoem: Boolean(text.isPoem),
            voice: selectedVoice,
          }),
        });

        if (!res.ok) {
          throw new Error(`TTS server responded with ${res.status}`);
        }

        const data = await res.json();
        if (!data.audioBase64) {
          throw new Error('Không nhận được dữ liệu âm thanh');
        }

        const audio = new Audio(`data:${data.mimeType || 'audio/mpeg'};base64,${data.audioBase64}`);
        audio.preload = 'auto';
        audioCacheRef.current.set(startIndex, audio);
        return audio;
      } catch (err) {
        console.warn('Lỗi tải đoạn âm thanh giọng đọc:', err);
        return null;
      } finally {
        preloadingMapRef.current.delete(startIndex);
      }
    })();

    preloadingMapRef.current.set(startIndex, promise);
    return promise;
  };

  // Preload subsequent chunk in advance
  const preloadNextChunk = (fromIndex: number) => {
    const nextIdx = fromIndex + CHUNK_SIZE;
    if (nextIdx < sentences.length) {
      loadChunkAudio(nextIdx);
    }
  };

  // Play Northern Vietnamese Teacher Voice (Hà Nội chuẩn, truyền cảm)
  const handleStartAudio = async (startIndex = 0) => {
    if (startIndex >= sentences.length) {
      handleStopAudio();
      try {
        confetti({ particleCount: 30, spread: 50, origin: { y: 0.6 } });
      } catch {}
      return;
    }

    // Stop current playing audio
    if (aiAudioRef.current) {
      aiAudioRef.current.pause();
      aiAudioRef.current.onended = null;
      aiAudioRef.current.ontimeupdate = null;
      aiAudioRef.current.onerror = null;
      aiAudioRef.current = null;
    }

    isPlayingRef.current = true;
    setIsPlayingAudio(true);
    setIsPausedAudio(false);
    setActiveSentenceIndex(startIndex);
    setVoiceNotice(null);

    let audio = audioCacheRef.current.get(startIndex) || null;
    if (!audio) {
      setIsLoadingAIVoice(true);
      audio = await loadChunkAudio(startIndex);
      setIsLoadingAIVoice(false);
    }

    if (!isPlayingRef.current) return;

    if (!audio) {
      setIsPlayingAudio(false);
      setIsPausedAudio(false);
      setActiveSentenceIndex(-1);
      setVoiceNotice('Không thể tải giọng đọc lúc này. Em hãy bấm "Thử lại" để nghe nhé.');
      return;
    }

    const chunkSentences = sentences.slice(startIndex, startIndex + CHUNK_SIZE);
    audio.playbackRate = playbackSpeed;

    audio.onplay = () => {
      setIsPlayingAudio(true);
      setIsPausedAudio(false);
      setActiveSentenceIndex(startIndex);
      // Preload next chunk smoothly only after current audio is actively playing
      setTimeout(() => {
        if (isPlayingRef.current) {
          preloadNextChunk(startIndex);
        }
      }, 400);
    };

    audio.ontimeupdate = () => {
      if (audio.duration > 0 && chunkSentences.length > 1) {
        const ratio = audio.currentTime / audio.duration;
        const offset = Math.min(chunkSentences.length - 1, Math.floor(ratio * chunkSentences.length));
        setActiveSentenceIndex(startIndex + offset);
      }
    };

    audio.onended = () => {
      const nextIndex = startIndex + CHUNK_SIZE;
      if (nextIndex < sentences.length && isPlayingRef.current) {
        handleStartAudio(nextIndex);
      } else {
        setIsPlayingAudio(false);
        setIsPausedAudio(false);
        setActiveSentenceIndex(-1);
        try {
          confetti({ particleCount: 40, spread: 50, origin: { y: 0.6 } });
        } catch {}
      }
    };

    audio.onerror = () => {
      setIsPlayingAudio(false);
      setIsPausedAudio(false);
      setVoiceNotice('Quá trình phát âm thanh bị gián đoạn. Vui lòng bấm nghe lại.');
    };

    aiAudioRef.current = audio;
    try {
      await audio.play();
    } catch (playErr) {
      console.warn('Audio play error:', playErr);
    }
  };

  const handlePauseAudio = () => {
    if (aiAudioRef.current && isPlayingAudio) {
      aiAudioRef.current.pause();
      setIsPausedAudio(true);
    }
  };

  const handleResumeAudio = () => {
    if (aiAudioRef.current && isPausedAudio) {
      aiAudioRef.current.play().catch(() => {});
      setIsPausedAudio(false);
    }
  };

  const handleReplayAudio = () => {
    handleStartAudio(0);
  };

  const handleStopAudio = () => {
    isPlayingRef.current = false;
    if (aiAudioRef.current) {
      aiAudioRef.current.pause();
      aiAudioRef.current.onended = null;
      aiAudioRef.current.ontimeupdate = null;
      aiAudioRef.current.onerror = null;
      aiAudioRef.current = null;
    }
    setIsPlayingAudio(false);
    setIsPausedAudio(false);
    setIsLoadingAIVoice(false);
    setActiveSentenceIndex(-1);
  };

  // ================= SPEECH-TO-TEXT (STT) MICROPHONE COACH =================
  const [isRecording, setIsRecording] = useState(false);
  const [spokenTranscript, setSpokenTranscript] = useState('');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingStats, setRecordingStats] = useState<{
    accuracy: number;
    wpm: number;
    missedWords: string[];
    correctWordsCount: number;
    totalTargetWords: number;
    aiFeedback?: string;
  } | null>(null);

  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (initialMode === 'voice') {
      // scroll to voice section
      setTimeout(() => {
        document.getElementById('voice-practice-section')?.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    }
  }, [initialMode]);

  const startVoiceRecording = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Trình duyệt của bạn hiện chưa hỗ trợ Web Speech Recognition. Khuyên dùng Google Chrome hoặc Microsoft Edge để có trải nghiệm nhận diện giọng nói tiếng Việt tốt nhất.');
      return;
    }

    try {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }

      const recognition = new SpeechRecognition();
      recognition.lang = 'vi-VN';
      recognition.continuous = true;
      recognition.interimResults = true;

      setSpokenTranscript('');
      setRecordingStats(null);
      setRecordingSeconds(0);
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);

      recognition.onresult = (event: any) => {
        let currentTranscript = '';
        for (let i = 0; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript + ' ';
        }
        setSpokenTranscript(currentTranscript.trim());
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition status:', event.error);
        if (event.error === 'not-allowed') {
          alert('Vui lòng cấp quyền truy cập Micro trên trình duyệt để luyện đọc.');
          stopVoiceRecording();
        }
      };

      recognition.onend = () => {
        if (isRecording) {
          // Restart if still in recording state
          try {
            recognition.start();
          } catch {}
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (e) {
      console.error('Failed to start speech recognition', e);
      setIsRecording(false);
    }
  };

  const stopVoiceRecording = async () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);

    // Calculate reading stats against original text
    analyzeSpeechReading(spokenTranscript, recordingSeconds);
  };

  const analyzeSpeechReading = async (spoken: string, durationSec: number) => {
    const cleanOriginal = text.content.toLowerCase().replace(/[.,!?:;'"“”\-()]/g, ' ').split(/\s+/).filter(Boolean);
    const cleanSpoken = spoken.toLowerCase().replace(/[.,!?:;'"“”\-()]/g, ' ').split(/\s+/).filter(Boolean);

    if (cleanSpoken.length === 0) {
      setRecordingStats({
        accuracy: 0,
        wpm: 0,
        missedWords: cleanOriginal.slice(0, 10),
        correctWordsCount: 0,
        totalTargetWords: cleanOriginal.length,
        aiFeedback: 'Hệ thống chưa thu nhận được giọng đọc rõ ràng. Em hãy kiểm tra micro và đọc to hơn một chút nhé!'
      });
      return;
    }

    // Compare word matching
    let matched = 0;
    const missed: string[] = [];
    const spokenSet = new Set(cleanSpoken);

    cleanOriginal.forEach(w => {
      if (spokenSet.has(w)) {
        matched++;
      } else {
        if (missed.length < 8 && !missed.includes(w)) {
          missed.push(w);
        }
      }
    });

    const accuracy = Math.min(100, Math.round((matched / Math.max(cleanOriginal.length, 1)) * 100));
    const effectiveMinutes = Math.max(durationSec / 60, 0.2);
    const wpm = Math.round(cleanSpoken.length / effectiveMinutes);

    // Call server AI speech coach for nuanced feedback
    let coachFeedback = `Em đã đọc được ${cleanSpoken.length} từ trong ${durationSec} giây (tốc độ ~${wpm} từ/phút). Phát âm rất tự tin!`;
    try {
      const res = await fetch('/api/speech-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalText: text.content.slice(0, 800),
          transcribedText: spoken.slice(0, 800),
          textGenre: text.genre,
          durationSeconds: durationSec
        })
      });
      const data = await res.json();
      if (data.expressionFeedback) {
        coachFeedback = `${data.encouragement || ''} ${data.expressionFeedback}`;
      }
    } catch {}

    setRecordingStats({
      accuracy,
      wpm,
      missedWords: missed,
      correctWordsCount: matched,
      totalTargetWords: cleanOriginal.length,
      aiFeedback: coachFeedback
    });

    // Complete reading reward
    completeReading(text.id, text.title, accuracy, wpm);
    confetti({ particleCount: 50, spread: 60, origin: { y: 0.8 } });
  };

  // Handle clicking a word for explanation
  const handleWordClick = async (vocab: VocabularyItem) => {
    setSelectedWord(vocab);
    setLoadingWordAi(true);
    setAiWordExplanation(null);

    try {
      const res = await fetch('/api/explain-word', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word: vocab.word,
          contextSentence: vocab.example || '',
          textTitle: text.title
        })
      });
      const data = await res.json();
      setAiWordExplanation(data);
    } catch {
      setAiWordExplanation(null);
    } finally {
      setLoadingWordAi(false);
    }
  };

  // Font size class mapping
  const fontSizeClass = {
    normal: 'text-base sm:text-lg leading-relaxed sm:leading-8',
    large: 'text-lg sm:text-xl leading-loose',
    xlarge: 'text-xl sm:text-2xl leading-loose'
  }[fontSize];

  // If user selected 'quiz' tab only, render the complete quiz worksheet directly
  if (activeTab === 'quiz') {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Top Back & Mode Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            onClick={(e) => {
              createRipple(e);
              onBack();
            }}
            className="btn-soft-pastel ripple-container inline-flex items-center space-x-1.5 text-xs sm:text-sm font-semibold px-3.5 py-2 rounded-xl transition-all shadow-xs cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-[#00A99D]" />
            <span>Quay lại Mục lục</span>
          </button>

          {/* View Mode Switcher */}
          <div className="flex items-center bg-white border border-[#E0EBF4] p-1 rounded-2xl text-xs font-semibold shadow-xs">
            <button
              onClick={(e) => {
                createRipple(e);
                setActiveTab('read');
              }}
              className="px-3.5 py-1.5 rounded-xl transition-all flex items-center space-x-1.5 text-[#61758A] hover:text-[#102A43] cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Bài đọc</span>
            </button>

            <button
              onClick={(e) => {
                createRipple(e);
                setActiveTab('quiz');
              }}
              className="px-3.5 py-1.5 rounded-xl transition-all flex items-center space-x-1.5 bg-[#00A99D] text-white shadow-xs font-bold cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Câu hỏi đọc hiểu ({text.questions.length})</span>
            </button>

            <button
              onClick={(e) => {
                createRipple(e);
                setActiveTab('split');
              }}
              className="hidden md:flex px-3.5 py-1.5 rounded-xl transition-all items-center space-x-1.5 text-[#61758A] hover:text-[#102A43] cursor-pointer"
              title="Đọc văn bản bên trái, trả lời câu hỏi bên phải"
            >
              <Columns className="w-3.5 h-3.5" />
              <span>Xem song song</span>
            </button>
          </div>
        </div>

        {/* Embedded Quiz System */}
        <QuizSystem
          text={text}
          onBackToReading={() => setActiveTab('read')}
          onGoToGames={() => {}}
          onOpenAssistantForHint={onOpenAssistantForContext}
        />
      </div>
    );
  }

  // DEDICATED POETRY READER VIEW FOR POEMS
  if (text.isPoem && activeTab === 'read') {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Top Back & Mode Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            onClick={(e) => {
              createRipple(e);
              onBack();
            }}
            className="btn-soft-pastel ripple-container inline-flex items-center space-x-1.5 text-xs sm:text-sm font-semibold px-3.5 py-2 rounded-xl transition-all shadow-xs cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-[#00A99D]" />
            <span>Quay lại Mục lục</span>
          </button>

          {/* Integrated View Mode Switcher */}
          <div className="flex items-center bg-white border border-[#E0EBF4] p-1 rounded-2xl text-xs font-semibold shadow-xs">
            <button
              onClick={() => setActiveTab('read')}
              className="bg-[#00A99D] text-white px-3.5 py-1.5 rounded-xl transition-all flex items-center space-x-1.5 font-bold shadow-xs cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Đọc thơ</span>
            </button>

            <button
              onClick={() => setActiveTab('quiz')}
              className="px-3.5 py-1.5 rounded-xl transition-all flex items-center space-x-1.5 cursor-pointer text-[#61758A] hover:text-[#102A43]"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Câu hỏi đọc hiểu ({text.questions.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('split')}
              className="hidden md:flex px-3.5 py-1.5 rounded-xl transition-all items-center space-x-1.5 cursor-pointer text-[#61758A] hover:text-[#102A43]"
            >
              <Columns className="w-3.5 h-3.5" />
              <span>Xem song song</span>
            </button>


          </div>
        </div>

        {/* Dedicated Modern Literary Poetry Reader */}
        <PoetryReader
          text={text}
          onGoToQuiz={() => setActiveTab('quiz')}
          onSelectWord={(vocab) => setSelectedWord(vocab)}
        />
      </div>
    );
  }

  return (
    <div className={`mx-auto px-4 sm:px-6 py-6 space-y-6 ${activeTab === 'split' ? 'max-w-7xl' : 'max-w-4xl'}`}>
      {/* Top Back & Mode Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          onClick={(e) => {
            createRipple(e);
            onBack();
          }}
          className="btn-soft-pastel ripple-container inline-flex items-center space-x-1.5 text-xs sm:text-sm font-semibold px-3.5 py-2 rounded-xl transition-all shadow-xs cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 text-[#00A99D]" />
          <span>Quay lại Mục lục</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {/* Integrated View Mode Switcher */}
          <div className="flex items-center bg-white border border-[#E0EBF4] p-1 rounded-2xl text-xs font-semibold shadow-xs">
            <button
              onClick={(e) => {
                createRipple(e);
                setActiveTab('read');
              }}
              className={`px-3 py-1.5 rounded-xl transition-all flex items-center space-x-1.5 cursor-pointer ${
                activeTab === 'read'
                  ? 'bg-[#00A99D] text-white shadow-xs font-bold'
                  : 'text-[#61758A] hover:text-[#102A43]'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Bài đọc</span>
            </button>

            <button
              onClick={(e) => {
                createRipple(e);
                setActiveTab('quiz');
              }}
              className="px-3 py-1.5 rounded-xl transition-all flex items-center space-x-1.5 cursor-pointer text-[#61758A] hover:text-[#102A43]"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Câu hỏi đọc hiểu ({text.questions.length})</span>
            </button>

            <button
              onClick={(e) => {
                createRipple(e);
                setActiveTab(activeTab === 'split' ? 'read' : 'split');
              }}
              className={`hidden md:flex px-3 py-1.5 rounded-xl transition-all items-center space-x-1.5 cursor-pointer ${
                activeTab === 'split'
                  ? 'bg-[#00A99D] text-white shadow-xs font-bold'
                  : 'text-[#61758A] hover:text-[#102A43]'
              }`}
              title="Đọc văn bản bên trái, trả lời câu hỏi bên phải"
            >
              <Columns className="w-3.5 h-3.5" />
              <span>Xem song song</span>
            </button>
          </div>

          {/* Font size toggle */}
          <div className="flex items-center bg-white border border-[#E0EBF4] rounded-2xl p-1 text-xs font-semibold text-[#61758A] shadow-xs">
            <Type className="w-3.5 h-3.5 mx-1.5 text-[#61758A]" />
            {(['normal', 'large', 'xlarge'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFontSize(s)}
                className={`px-2 py-0.5 rounded-lg transition-colors cursor-pointer ${
                  fontSize === s ? 'bg-[#00A99D] text-white font-bold' : 'hover:bg-[#F4FAFF]'
                }`}
              >
                {s === 'normal' ? 'A' : s === 'large' ? 'A+' : 'A++'}
              </button>
            ))}
          </div>


        </div>
      </div>

      {/* Main Grid: Single Column for 'read' or 2 Columns for 'split' */}
      <div className={activeTab === 'split' ? 'grid grid-cols-1 lg:grid-cols-2 gap-6 items-start' : 'space-y-6'}>
        {/* Left / Main: Reading Text Paper Card */}
        <div className="space-y-6">
          <div ref={articleCardRef} className="edu-card bg-white rounded-3xl p-6 sm:p-10 border border-[#E0EBF4] shadow-xs space-y-6 relative">
            {/* ================= READING PROGRESS BAR ================= */}
            <div className="bg-gradient-to-r from-[#EAF6FF] via-white to-[#E0F8F3] p-4 sm:p-4.5 rounded-2xl border border-[#CCE3F5] shadow-2xs space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#00A99D] to-[#008F85] text-white flex items-center justify-center shadow-xs shrink-0">
                    <BookCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-extrabold text-[#102A43] text-xs sm:text-sm">Tiến độ đọc bài</span>
                      <span className="text-[10px] bg-white text-[#007F76] font-bold px-2 py-0.5 rounded-full border border-[#BDE8E0]">
                        Trực quan %
                      </span>
                    </div>
                    <p className="text-[#61758A] text-[11px] font-medium hidden sm:block">
                      {readingProgress >= 100 
                        ? '🎉 Chúc mừng em đã hoàn thành 100% nội dung bài đọc!'
                        : 'Cuộn trang từ từ hoặc bật giọng đọc chuẩn để theo dõi bài học'}
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
              <div className="w-full h-3 bg-[#E0EBF4] rounded-full overflow-hidden p-0.5 shadow-inner relative">
                <div
                  className="h-full rounded-full transition-all duration-300 ease-out bg-gradient-to-r from-[#00A99D] via-[#3285E8] to-[#00A99D] relative overflow-hidden"
                  style={{ width: `${Math.max(readingProgress, 4)}%` }}
                >
                  <div className="absolute inset-0 bg-white/25 -skew-x-12 animate-pulse" />
                </div>
              </div>

              {/* Milestone Checkpoints */}
              <div className="flex justify-between text-[10px] text-[#61758A] px-1 font-semibold">
                <span className={readingProgress >= 0 ? 'text-[#00A99D] font-bold' : ''}>0%</span>
                <span className={readingProgress >= 25 ? 'text-[#00A99D] font-bold' : ''}>25%</span>
                <span className={readingProgress >= 50 ? 'text-[#00A99D] font-bold' : ''}>50%</span>
                <span className={readingProgress >= 75 ? 'text-[#00A99D] font-bold' : ''}>75%</span>
                <span className={readingProgress >= 100 ? 'text-emerald-600 font-bold' : ''}>100% (Hoàn thành)</span>
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

            {/* Unit & Metadata Header */}
            <div className="border-b border-[#E0EBF4] pb-5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#007F76] bg-[#E0F8F3] px-3 py-1 rounded-full border border-[#B2EADF]">
                  {text.bookCollection} &bull; {text.unit}
                </span>
                <span className="text-xs text-[#61758A] flex items-center space-x-1">
                  <Clock className="w-3.5 h-3.5 text-[#00A99D]" />
                  <span>Thời gian đọc: ~{text.estimatedReadMinutes} phút</span>
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold text-[#102A43] tracking-tight">
                {text.title}
              </h1>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm text-[#61758A] font-medium">
                <p className="flex items-center space-x-1.5 text-[#102A43] font-semibold">
                  <Feather className="w-4 h-4 text-[#00A99D]" />
                  <span>Tác giả / Nguồn: {text.authorOrSource}</span>
                </p>

                {text.isPoem && (
                  <button
                    onClick={() => setShowPoetryRhythms(!showPoetryRhythms)}
                    className={`inline-flex items-center space-x-1 px-3 py-1 rounded-xl text-xs font-semibold transition-colors border cursor-pointer ${
                      showPoetryRhythms
                        ? 'bg-[#EAF6FF] text-[#1E65B5] border-[#C3E4FF]'
                        : 'bg-[#F4FAFF] text-[#61758A] border-[#E0EBF4]'
                    }`}
                  >
                    <Music className="w-3.5 h-3.5 text-[#3285E8]" />
                    <span>{showPoetryRhythms ? 'Ẩn ngắt nhịp thơ' : 'Hiện ngắt nhịp thơ & cảm xúc'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Text-to-Speech (TTS) Control Bar */}
            <div className="bg-[#F4FAFF] p-4 sm:p-5 rounded-2xl border border-[#E0EBF4] space-y-3 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center space-x-2.5">
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-xs transition-colors ${
                    isPlayingAudio ? 'bg-[#00A99D] text-white animate-pulse' : 'bg-[#E0F8F3] text-[#00A99D]'
                  }`}>
                    <Volume2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <p className="text-xs sm:text-sm font-bold text-[#102A43]">
                        Giọng đọc mẫu: {selectedVoice === 'male' ? 'Thầy giáo Nam Minh (Nam Hà Nội)' : 'Cô giáo Hoài My (Nữ Hà Nội)'}
                      </p>
                      <span className="text-[10px] bg-white text-[#007F76] font-bold px-2 py-0.5 rounded-full border border-[#B2EADF]">
                        Chuẩn truyền cảm &bull; Biểu cảm văn học
                      </span>
                    </div>
                    <p className="text-[11px] text-[#61758A]">
                      Giọng đọc chuẩn ngữ âm Hà Nội, ngắt nhịp lắng đọng, truyền tải trọn vẹn cảm xúc tác phẩm
                    </p>
                  </div>
                </div>

                {/* Voice Selection Toggle */}
                <div className="flex items-center bg-white p-1 rounded-2xl border border-[#E0EBF4] shadow-xs text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => handleVoiceChange('female')}
                    className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center space-x-1.5 ${
                      selectedVoice === 'female'
                        ? 'bg-[#00A99D] text-white shadow-xs'
                        : 'text-[#61758A] hover:text-[#102A43]'
                    }`}
                  >
                    <span>🌸 Cô giáo Hoài My</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleVoiceChange('male')}
                    className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center space-x-1.5 ${
                      selectedVoice === 'male'
                        ? 'bg-[#102A43] text-white shadow-xs'
                        : 'text-[#61758A] hover:text-[#102A43]'
                    }`}
                  >
                    <span>🌿 Thầy giáo Nam Minh</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Speed selector */}
                  <div className="flex items-center space-x-1 bg-white px-2 py-1 rounded-xl border border-[#E0EBF4] text-xs font-semibold text-[#61758A] shadow-xs">
                    <span className="text-[10px] text-[#61758A]">Tốc độ:</span>
                    {[0.75, 1.0, 1.25].map(spd => (
                      <button
                        key={spd}
                        onClick={() => {
                          setPlaybackSpeed(spd);
                          if (aiAudioRef.current) {
                            aiAudioRef.current.playbackRate = spd;
                          }
                        }}
                        className={`px-1.5 py-0.5 rounded cursor-pointer ${playbackSpeed === spd ? 'bg-[#00A99D] text-white font-bold' : 'hover:bg-[#F4FAFF]'}`}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>

                  {/* Play/Pause/Stop Buttons */}
                  {isLoadingAIVoice ? (
                    <div className="inline-flex items-center space-x-1.5 bg-[#E0F8F3] text-[#007F76] px-4 py-2 rounded-xl text-xs font-bold border border-[#B2EADF] animate-pulse">
                      <Sparkles className="w-3.5 h-3.5 animate-spin text-[#00A99D]" />
                      <span>{selectedVoice === 'male' ? 'Đang kết nối Thầy giáo Nam Minh đọc mẫu...' : 'Đang kết nối Cô giáo Hoài My đọc mẫu...'}</span>
                    </div>
                  ) : !isPlayingAudio ? (
                    <button
                      onClick={(e) => {
                        createRipple(e);
                        handleStartAudio(0);
                      }}
                      className="btn-primary-teal ripple-container inline-flex items-center space-x-2 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-white text-white" />
                      <span>Nghe đọc mẫu chuẩn</span>
                    </button>
                  ) : isPausedAudio ? (
                    <button
                      onClick={(e) => {
                        createRipple(e);
                        handleResumeAudio();
                      }}
                      className="btn-primary-teal ripple-container inline-flex items-center space-x-1.5 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-white text-white" />
                      <span>Tiếp tục nghe</span>
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        createRipple(e);
                        handlePauseAudio();
                      }}
                      className="btn-soft-pastel ripple-container inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
                    >
                      <Pause className="w-3.5 h-3.5 fill-[#102A43]" />
                      <span>Tạm dừng</span>
                    </button>
                  )}

                  <button
                    onClick={handleReplayAudio}
                    className="p-2 rounded-xl text-[#61758A] hover:text-[#102A43] hover:bg-white transition-colors border border-transparent hover:border-[#E0EBF4] cursor-pointer"
                    title="Đọc lại từ đầu"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  {isPlayingAudio && (
                    <button
                      onClick={handleStopAudio}
                      className="p-2 rounded-xl text-rose-600 hover:text-rose-800 hover:bg-white transition-colors border border-transparent hover:border-rose-200 cursor-pointer"
                      title="Dừng phát"
                    >
                      <VolumeX className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

          {/* Voice notice banner if any */}
          {voiceNotice && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center justify-between gap-2 animate-in fade-in">
              <div className="flex items-center space-x-2">
                <Info className="w-4 h-4 text-amber-600 shrink-0" />
                <span>{voiceNotice}</span>
              </div>
              <button
                onClick={() => handleStartAudio(activeSentenceIndex > 0 ? activeSentenceIndex : 0)}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0"
              >
                Thử lại
              </button>
            </div>
          )}

          {/* Active Speaking Status Bar & Equalizer */}
          {isPlayingAudio && (
            <div className="bg-white p-3 rounded-xl border border-rose-200 flex flex-wrap items-center justify-between gap-2 animate-in fade-in">
              <div className="flex items-center space-x-3">
                {/* Audio animated waveform */}
                <div className="flex items-end space-x-0.5 h-5 px-1">
                  <span className="w-1 bg-rose-500 rounded-full animate-bounce [animation-delay:0.1s] h-3"></span>
                  <span className="w-1 bg-pink-500 rounded-full animate-bounce [animation-delay:0.3s] h-5"></span>
                  <span className="w-1 bg-rose-600 rounded-full animate-bounce [animation-delay:0.2s] h-2.5"></span>
                  <span className="w-1 bg-rose-400 rounded-full animate-bounce [animation-delay:0.4s] h-4"></span>
                </div>
                <div className="text-xs">
                  <span className="font-extrabold text-rose-700">
                    Đang đọc câu {activeSentenceIndex >= 0 ? activeSentenceIndex + 1 : 1}/{sentences.length}:
                  </span>{' '}
                  <span className="text-slate-700 italic font-medium">
                    "{sentences[activeSentenceIndex >= 0 ? activeSentenceIndex : 0]}"
                  </span>
                </div>
              </div>

              {/* Prev / Next chunk nav */}
              <div className="flex items-center space-x-1.5 text-[11px] font-bold text-slate-600">
                <button
                  onClick={() => {
                    const prevIdx = Math.max(0, (activeSentenceIndex >= 0 ? activeSentenceIndex : 0) - 4);
                    handleStartAudio(prevIdx);
                  }}
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                  title="Đoạn trước"
                >
                  ◀ Đoạn trước
                </button>
                <button
                  onClick={() => {
                    const nextIdx = Math.min(sentences.length - 1, (activeSentenceIndex >= 0 ? activeSentenceIndex : 0) + 4);
                    handleStartAudio(nextIdx);
                  }}
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                  title="Đoạn kế tiếp"
                >
                  Đoạn kế ▶
                </button>
              </div>
            </div>
          )}
        </div>

        {/* POETRY READING IN SPLIT VIEW */}
        {text.isPoem ? (
          <div className="space-y-6 font-serif-academic text-[#2C2115] bg-[#FAF7F2] p-6 sm:p-8 rounded-2xl border border-[#EDE4D6] shadow-2xs">
            {text.content.split('\n\n').map((stanza, sIdx) => (
              <div key={sIdx} className={`space-y-1.5 ${fontSizeClass} leading-[1.85]`}>
                {stanza.split('\n').map((line, lIdx) => (
                  <p key={lIdx} className="tracking-wide">
                    {line}
                  </p>
                ))}
              </div>
            ))}
          </div>
        ) : (
          /* STANDARD PROSE READING WITH PARAGRAPH FORMATTING */
          <div className={`space-y-5 text-slate-800 font-serif-literary ${fontSizeClass}`}>
            {text.content.split('\n\n').map((paragraph, pIdx) => (
              <p 
                key={pIdx} 
                className="indent-6 text-justify leading-relaxed transition-colors"
              >
                {paragraph.split(' ').map((word, wIdx) => {
                  const cleanWord = word.replace(/[.,!?:;'"“”\-()]/g, '');
                  const vocabMatch = text.vocabularyList.find(
                    v => v.word.toLowerCase() === cleanWord.toLowerCase()
                  );

                  if (vocabMatch) {
                    return (
                      <React.Fragment key={wIdx}>
                        <span
                          onClick={() => handleWordClick(vocabMatch)}
                          className="text-[#007F76] font-semibold underline decoration-dotted decoration-[#00A99D] hover:bg-[#E0F8F3] cursor-pointer rounded px-0.5 transition-colors"
                          title="Bấm để xem giải nghĩa từ khó"
                        >
                          {word}
                        </span>{' '}
                      </React.Fragment>
                    );
                  }
                  return word + ' ';
                })}
              </p>
            ))}
          </div>
        )}

        {/* VOCABULARY ACCORDION / FOOTNOTES */}
        <div className="pt-6 border-t border-[#E0EBF4] space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#102A43] flex items-center space-x-2">
              <BookOpen className="w-4 h-4 text-[#00A99D]" />
              <span>Từ ngữ cần giải thích trong bài ({text.vocabularyList.length} từ)</span>
            </h3>
            <span className="text-xs text-[#61758A]">Bấm vào từng từ để xem phân tích chi tiết</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {text.vocabularyList.map((vocab, vIdx) => (
              <div
                key={vIdx}
                onClick={() => handleWordClick(vocab)}
                className="p-3 rounded-xl border border-[#E0EBF4] bg-[#F4FAFF] hover:bg-[#E0F8F3] hover:border-[#00A99D]/60 cursor-pointer transition-all space-y-1 shadow-2xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-[#102A43]">{vocab.word}</span>
                  {vocab.wordType && (
                    <span className="text-[10px] bg-white text-[#61758A] px-1.5 py-0.5 rounded border border-[#E0EBF4]">
                      {vocab.wordType}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#61758A] leading-snug">{vocab.meaning}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ================= SECTION 5: VOICE READING COACH (MICROPHONE) ================= */}
      <div 
        id="voice-practice-section"
        className="edu-card bg-white rounded-3xl p-6 sm:p-8 border border-[#E0EBF4] shadow-xs space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E0EBF4] pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-[#E0F8F3] text-[#00A99D] flex items-center justify-center shadow-xs">
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#102A43]">
                Luyện đọc thành tiếng & Đọc biểu cảm
              </h2>
              <p className="text-xs text-[#61758A]">
                Sử dụng micro để kiểm tra phát âm, tốc độ đọc và nhận phản hồi từ Huấn luyện viên AI
              </p>
            </div>
          </div>

          {/* Record button */}
          {!isRecording ? (
            <button
              onClick={(e) => {
                createRipple(e);
                startVoiceRecording();
              }}
              className="btn-primary-teal ripple-container inline-flex items-center space-x-2 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-xs transition-all cursor-pointer"
            >
              <Mic className="w-4 h-4 text-white" />
              <span>Bắt đầu đọc (Bật Mic)</span>
            </button>
          ) : (
            <button
              onClick={(e) => {
                createRipple(e);
                stopVoiceRecording();
              }}
              className="inline-flex items-center space-x-2 bg-rose-600 hover:bg-rose-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-xs animate-pulse transition-all cursor-pointer"
            >
              <MicOff className="w-4 h-4" />
              <span>Dừng đọc ({recordingSeconds}s)</span>
            </button>
          )}
        </div>

        {/* Live Audio Visualizer Animation when recording */}
        {isRecording && (
          <div className="p-4 bg-teal-50/60 rounded-2xl border border-teal-200 text-center space-y-3">
            <div className="flex items-center justify-center space-x-1.5 h-8">
              <span className="w-1.5 h-6 bg-teal-600 rounded-full animate-wave-1"></span>
              <span className="w-1.5 h-8 bg-teal-600 rounded-full animate-wave-2"></span>
              <span className="w-1.5 h-5 bg-teal-600 rounded-full animate-wave-3"></span>
              <span className="w-1.5 h-7 bg-teal-600 rounded-full animate-wave-4"></span>
              <span className="w-1.5 h-4 bg-teal-600 rounded-full animate-wave-2"></span>
            </div>
            <p className="text-xs font-semibold text-teal-800">
              Đang lắng nghe giọng đọc của em... Hãy đọc to, rõ ràng và diễn cảm nhé!
            </p>
            {spokenTranscript && (
              <p className="text-xs text-slate-700 italic bg-white p-2.5 rounded-xl border border-teal-100 max-h-24 overflow-y-auto">
                "{spokenTranscript}"
              </p>
            )}
          </div>
        )}

        {/* Voice Feedback & Evaluation Results */}
        {recordingStats && (
          <div className="p-5 bg-gradient-to-br from-slate-50 to-teal-50/30 rounded-2xl border border-slate-200 space-y-4 animate-in fade-in duration-300">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-800 flex items-center space-x-2">
                <Award className="w-4 h-4 text-emerald-600" />
                <span>Kết quả luyện đọc thành tiếng</span>
              </h4>
              <span className="text-xs font-bold text-teal-700 bg-teal-100 px-2.5 py-0.5 rounded-full">
                +40 XP Đọc hay
              </span>
            </div>

            {/* 4 Criteria Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                <p className="text-[11px] text-slate-500 font-semibold">1. Độ chính xác từ ngữ</p>
                <p className="text-xl font-extrabold text-emerald-600 mt-1">{recordingStats.accuracy}%</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Khớp {recordingStats.correctWordsCount}/{recordingStats.totalTargetWords} từ</p>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                <p className="text-[11px] text-slate-500 font-semibold">2. Tốc độ đọc (WPM)</p>
                <p className="text-xl font-extrabold text-blue-600 mt-1">{recordingStats.wpm}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Từ / phút (chuẩn: 110-130)</p>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                <p className="text-[11px] text-slate-500 font-semibold">3. Ngắt nghỉ theo dấu câu</p>
                <p className="text-sm font-bold text-slate-700 mt-2">
                  {recordingStats.wpm > 150 ? 'Khá nhanh, cần ngắt hơi' : recordingStats.wpm < 70 ? 'Cần đọc liền mạch hơn' : 'Hài hòa, đúng nhịp'}
                </p>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                <p className="text-[11px] text-slate-500 font-semibold">4. Đọc biểu cảm</p>
                <p className="text-sm font-bold text-teal-700 mt-2">
                  {recordingStats.accuracy > 80 ? 'Truyền cảm, sáng giọng' : 'Cần rèn luyện thêm'}
                </p>
              </div>
            </div>

            {/* Missed words list */}
            {recordingStats.missedWords.length > 0 && (
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 space-y-1">
                <p className="font-bold flex items-center space-x-1">
                  <span>Một số từ cần chú ý đọc rõ hơn:</span>
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {recordingStats.missedWords.map((w, i) => (
                    <span key={i} className="bg-white px-2 py-0.5 rounded border border-amber-300 font-medium">
                      {w}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* AI Coach Feedback note */}
            {recordingStats.aiFeedback && (
              <div className="p-3.5 bg-blue-50/70 rounded-xl border border-blue-200 text-xs text-blue-900 space-y-1">
                <p className="font-bold flex items-center space-x-1.5 text-blue-800">
                  <Bot className="w-4 h-4 text-blue-600" />
                  <span>Lời khuyên từ Huấn luyện viên ReadMind AI:</span>
                </p>
                <p className="leading-relaxed">{recordingStats.aiFeedback}</p>
              </div>
            )}
          </div>
        )}
      </div>
        </div>

        {/* Right Column in Split Mode: Embedded QuizSystem */}
        {activeTab === 'split' && (
          <div className="space-y-6 lg:sticky lg:top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1">
            <QuizSystem
              text={text}
              onBackToReading={() => setActiveTab('read')}
              onGoToGames={() => {}}
              onOpenAssistantForHint={onOpenAssistantForContext}
            />
          </div>
        )}
      </div>

      {/* VOCABULARY DETAIL MODAL */}
      {selectedWord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-[#E0EBF4] space-y-4">
            <div className="flex items-center justify-between border-b border-[#E0EBF4] pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-xl bg-[#E0F8F3] text-[#00A99D] flex items-center justify-center font-bold text-sm">
                  Aa
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#102A43]">{selectedWord.word}</h3>
                  {selectedWord.wordType && (
                    <span className="text-xs text-[#61758A] font-medium">{selectedWord.wordType}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedWord(null)}
                className="text-[#61758A] hover:text-[#102A43] text-xs font-bold p-1 rounded-md cursor-pointer"
              >
                Đóng
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-bold text-[#61758A] uppercase tracking-wider">Ý nghĩa trong văn bản:</p>
                <p className="text-[#102A43] font-medium mt-0.5">{selectedWord.meaning}</p>
              </div>

              {selectedWord.nuance && (
                <div className="p-3 bg-[#E0F8F3] rounded-xl border border-[#B2EADF] text-xs text-[#007F76]">
                  <p className="font-bold">Sắc thái nghệ thuật:</p>
                  <p className="mt-0.5">{selectedWord.nuance}</p>
                </div>
              )}

              {/* AI Deep Explanation */}
              {loadingWordAi ? (
                <div className="p-3 bg-[#EAF6FF] rounded-xl text-xs text-[#1E65B5] flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-[#3285E8] animate-spin" />
                  <span>Trợ lý ReadMind AI đang phân tích từ ngữ theo ngữ cảnh...</span>
                </div>
              ) : aiWordExplanation ? (
                <div className="p-3 bg-[#EAF6FF]/70 rounded-xl border border-[#C3E4FF] text-xs text-[#102A43] space-y-1.5">
                  <p className="font-bold text-[#1E65B5] flex items-center space-x-1">
                    <Bot className="w-3.5 h-3.5 text-[#3285E8]" />
                    <span>Gợi mở từ Trợ lý AI:</span>
                  </p>
                  <p>{aiWordExplanation.nuance || aiWordExplanation.meaning}</p>
                  {aiWordExplanation.example && (
                    <p className="italic text-[#61758A]">Ví dụ câu: "{aiWordExplanation.example}"</p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => {
                  setSelectedWord(null);
                  onOpenAssistantForContext(`Hãy giải thích sâu hơn cho em về vẻ đẹp và tác dụng của từ "${selectedWord.word}" trong bài "${text.title}".`);
                }}
                className="inline-flex items-center space-x-1.5 text-xs font-bold text-[#007F76] hover:text-[#005B54] bg-[#E0F8F3] px-3.5 py-2 rounded-xl border border-[#B2EADF] cursor-pointer"
              >
                <Bot className="w-3.5 h-3.5 text-[#00A99D]" />
                <span>Hỏi thêm Trợ lý AI về từ này</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Sticky Action Bar: Move to 3 Levels Comprehension (if in 'read' view) */}
      {activeTab === 'read' && (
        <div className="bg-gradient-to-r from-[#E0F8F3] via-[#EAF6FF] to-[#F1EBFF] rounded-3xl p-6 border border-[#E0EBF4] shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-bold uppercase tracking-wider bg-[#00A99D] text-white px-2.5 py-0.5 rounded-lg shadow-2xs">
                Chuẩn GDPT 2018
              </span>
              <span className="text-xs font-bold text-[#102A43]">
                Phần Đọc hiểu 3 Mức độ
              </span>
            </div>
            <h3 className="text-sm sm:text-base font-bold text-[#102A43]">
              Luyện tập tự luận: 1. Nhận biết &bull; 2. Thông hiểu &bull; 3. Vận dụng
            </h3>
            <p className="text-xs text-[#61758A]">
              Có sẵn ô gõ câu trả lời, nhận xét và chấm điểm chi tiết từ Cô giáo ReadMind AI cùng đáp án chuẩn SGK mở khóa sau khi trả lời.
            </p>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto shrink-0">
            <button
              onClick={(e) => {
                createRipple(e);
                setActiveTab('quiz');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="btn-primary-teal ripple-container flex-1 sm:flex-none inline-flex items-center justify-center space-x-2 text-white px-6 py-3 rounded-2xl text-xs sm:text-sm font-bold shadow-md cursor-pointer"
            >
              <HelpCircle className="w-4 h-4 text-[#FFF2B2]" />
              <span>Làm Đọc hiểu 3 mức độ ({text.questions.length} câu)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
