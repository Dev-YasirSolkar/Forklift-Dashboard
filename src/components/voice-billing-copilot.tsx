'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Mic, MicOff, Volume2, VolumeX, Sparkles, Loader2, X, Radio, Check, Headphones } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export interface VoiceAction {
  type: 'OPEN_NEW_FORM' | 'DUPLICATE_INVOICE' | 'SET_FIELD' | 'ADD_LINE_ITEM' | 'UPDATE_LINE_ITEM' | 'REMOVE_LINE_ITEM' | 'REMOVE_EMPTY_ITEMS' | 'HIGHLIGHT_FIELD' | 'SAVE_INVOICE' | 'CLOSE_FORM';
  field?: string;
  value?: any;
  target?: string;
  invoiceId?: string;
  billNo?: number | string;
  billingMonth?: string;
  companyId?: string;
  newBillDate?: string;
  index?: number;
  particulars?: string;
  rate?: string;
  amount?: number;
}

export interface ActiveSubject {
  companyName?: string;
  companyId?: string;
  billNo?: number;
  invoiceId?: string;
}

interface VoiceBillingCopilotProps {
  activeFirm: 'Vithal' | 'RV';
  currentFormState: {
    isOpen: boolean;
    companyId?: string;
    companyName?: string;
    billDate?: string;
    billingMonth?: string;
    poNumber?: string;
    site?: string;
    items?: Array<{ index?: number; particulars: string; rate?: string; amount: number; isBlank?: boolean }>;
    subTotal?: number;
    taxTotal?: number;
    grandTotal?: number;
    balanceDue?: number;
    discount?: string;
    advanceReceived?: string;
    tdsPercentage?: string;
    editingInvoiceId?: string | null;
  };
  companies: Array<{ id: string; name: string }>;
  recentInvoices: Array<{
    id: string;
    billNo: number;
    companyId: string;
    companyName: string;
    billDate: string;
    billingMonth?: string;
    grandTotal: number;
    subTotal?: number;
    taxTotal?: number;
    advanceReceived?: number | string;
    discount?: number | string;
    poNumber?: string;
    site?: string;
    enterprise: string;
    items: Array<{ particulars: string; rate?: string; amount: number }>;
  }>;
  onExecuteAction: (action: VoiceAction) => void;
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export function VoiceBillingCopilot({
  activeFirm,
  currentFormState,
  companies,
  recentInvoices,
  onExecuteAction,
}: VoiceBillingCopilotProps) {
  const { toast } = useToast();
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isHandsFree, setIsHandsFree] = useState(true);
  const [transcript, setTranscript] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeSubject, setActiveSubject] = useState<ActiveSubject | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: `Namaste sir! Main Sara hoon — aapki 10-year senior billing manager. Hands-free dialogue active hai. Aap lagatar bolte rahiye, main system me live kaam karti rahoongi (jaise "JSW ka bill duplicate karo", "Bill 1544 duplicate karo", "OT add karo 10 hrs 500 rate", ya "Save karo").`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const isHandsFreeRef = useRef(true);
  const isSpeakingRef = useRef(false);

  useEffect(() => {
    isHandsFreeRef.current = isHandsFree;
  }, [isHandsFree]);

  // Keep active subject synchronized with screen if bill is open
  useEffect(() => {
    if (currentFormState.isOpen && currentFormState.companyName) {
      setActiveSubject(prev => {
        if (prev?.companyName === currentFormState.companyName) return prev;
        return {
          companyName: currentFormState.companyName,
          companyId: currentFormState.companyId
        };
      });
    }
  }, [currentFormState.isOpen, currentFormState.companyName, currentFormState.companyId]);

  // Preload and optimize natural female voice
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
      synthRef.current.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        if (synthRef.current) {
          synthRef.current.getVoices();
        }
      };
    }
  }, []);

  // Scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, transcript]);

  // High-Quality Human-Touch Female Voice TTS for Sara
  const speakResponse = useCallback((text: string, onEnd?: () => void) => {
    if (isMuted || !synthRef.current) {
      if (onEnd) onEnd();
      return;
    }

    try {
      // Abort ongoing recognition while speaking so microphone doesn't hear itself
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (e) {}
      }

      synthRef.current.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = synthRef.current.getVoices();

      // Prioritize natural, fluent, and warm female voices (Hindi / Indian English / Neural)
      const selectedVoice =
        // 1. Natural / Online Hindi Female (e.g. Microsoft Swara Online Natural, Google हिन्दी)
        voices.find(v => 
          (v.name.toLowerCase().includes('swara') || v.name.toLowerCase().includes('kalpana') || v.name.toLowerCase().includes('heera')) &&
          (v.lang.includes('hi') || v.lang.includes('IN'))
        ) ||
        // 2. Google Hindi Female
        voices.find(v => v.lang.includes('hi') && (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('google'))) ||
        voices.find(v => v.lang.includes('hi')) ||
        // 3. Indian English Female (Neerja, Veena, Kavya)
        voices.find(v => 
          v.lang.includes('IN') && 
          (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('neerja') || v.name.toLowerCase().includes('veena') || v.name.toLowerCase().includes('kavya'))
        ) ||
        // 4. English Female (Samantha, Zira, Jenny)
        voices.find(v => 
          (v.name.toLowerCase().includes('zira') || v.name.toLowerCase().includes('samantha') || v.name.toLowerCase().includes('jenny')) &&
          !v.name.toLowerCase().includes('male')
        ) ||
        voices[0];

      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      // Crisp, natural human conversational pace & warm resonant pitch (pitch 1.00 avoids pinched squeak)
      utterance.rate = 1.14;
      utterance.pitch = 1.00;

      utterance.onstart = () => {
        setIsSpeaking(true);
        isSpeakingRef.current = true;
      };

      const finishSpeech = () => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        if (onEnd) onEnd();
      };

      utterance.onend = finishSpeech;
      utterance.onerror = finishSpeech;

      synthRef.current.speak(utterance);
    } catch (e) {
      console.warn('Sara TTS error:', e);
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      if (onEnd) onEnd();
    }
  }, [isMuted]);

  // Send speech to Backend API and execute automation
  const handleProcessSpeech = useCallback(async (speechText: string) => {
    if (!speechText.trim()) return;

    setIsProcessing(true);
    const userMsg: Message = {
      role: 'user',
      text: speechText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, userMsg]);

    // Check if user is asking to pause/stop listening
    const isStopCommand = /^(stop|bas|pause|khatam|band karo|thank you sara|shukriya|bye)\b/i.test(speechText.trim());
    if (isStopCommand) {
      setIsHandsFree(false);
      isHandsFreeRef.current = false;
      const pauseReply = "Theek hai sir, main listening pause kar rahi hoon. Jab bhi kaam ho, mic click kijiye ga.";
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: pauseReply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
      setIsProcessing(false);
      setTranscript('');
      speakResponse(pauseReply);
      return;
    }

    try {
      const historyPayload = messages.slice(-6).map(m => ({
        role: m.role === 'user' ? ('user' as const) : ('model' as const),
        text: m.text
      }));

      const res = await fetch('/api/voice-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userSpeech: speechText,
          activeFirm,
          activeSubject,
          currentFormState,
          companies,
          recentInvoices,
          conversationHistory: historyPayload
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        const fallbackSpeech = data.spokenResponse || data.error || 'Server processing error';
        throw new Error(fallbackSpeech);
      }

      // Track active conversational subject across queries
      if (data.activeSubject && (data.activeSubject.companyName || data.activeSubject.billNo)) {
        setActiveSubject(data.activeSubject);
      }

      const assistantMsg: Message = {
        role: 'assistant',
        text: data.spokenResponse || 'Updates kar diye hain sir.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, assistantMsg]);

      // Execute actions step-by-step with visual satisfaction
      if (Array.isArray(data.actions) && data.actions.length > 0) {
        for (let i = 0; i < data.actions.length; i++) {
          const action = data.actions[i];
          onExecuteAction(action);
          await new Promise(r => setTimeout(r, 120));
        }
      }

      // Speak back the response
      speakResponse(data.spokenResponse, () => {
        // Continuous Hands-Free Dialogue Loop:
        // Automatically restart listening after Sara finishes speaking!
        if (isHandsFreeRef.current) {
          setTimeout(() => {
            startListening();
          }, 350);
        }
      });

    } catch (error: any) {
      console.error('Voice Processing Failed:', error);
      const errMsg = error?.message && error.message !== 'Server processing error'
        ? error.message
        : "Sara abhi connect nahi ho pa rahi hai. Kripya dobara try karein.";
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: errMsg,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
      speakResponse(errMsg, () => {
        if (isHandsFreeRef.current) {
          setTimeout(() => {
            startListening();
          }, 400);
        }
      });
    } finally {
      setIsProcessing(false);
      setTranscript('');
    }
  }, [activeFirm, activeSubject, currentFormState, companies, recentInvoices, messages, onExecuteAction, speakResponse]);

  // Start Voice Recognition
  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return;

    // Do not start if Sara is actively speaking
    if (isSpeakingRef.current) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast({
        variant: 'destructive',
        title: 'Browser Not Supported',
        description: 'Aapka browser Speech Recognition support nahi karta. Kripya Chrome ya Edge use karein.'
      });
      return;
    }

    try {
      if (synthRef.current) synthRef.current.cancel();

      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (e) {}
      }

      const recognition = new SpeechRecognition();
      recognition.lang = 'hi-IN'; // Robust Hinglish, Hindi & English
      recognition.continuous = false;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsListening(true);
        setIsOpen(true);
      };

      recognition.onresult = (event: any) => {
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          currentTranscript += event.results[i][0].transcript;
        }
        setTranscript(currentTranscript);
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition status:', event.error);
        if (event.error === 'no-speech') {
          // If silence detected in hands-free mode, restart listen loop cleanly
          setIsListening(false);
          if (isHandsFreeRef.current && !isSpeakingRef.current) {
            setTimeout(() => {
              if (isHandsFreeRef.current && !isSpeakingRef.current) {
                try { recognition.start(); } catch (e) {}
              }
            }, 600);
          }
          return;
        }
        setIsListening(false);
        if (event.error === 'not-allowed') {
          toast({
            variant: 'destructive',
            title: 'Microphone Permission Needed',
            description: 'Kripya browser me microphone allow karein.'
          });
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        setTranscript(finalText => {
          if (finalText && finalText.trim().length > 1) {
            handleProcessSpeech(finalText);
          } else if (isHandsFreeRef.current && !isSpeakingRef.current) {
            // Re-arm listening if hands-free is active and no speech was finalized
            setTimeout(() => {
              if (isHandsFreeRef.current && !isSpeakingRef.current) {
                try { recognition.start(); } catch (e) {}
              }
            }, 500);
          }
          return '';
        });
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.error('Failed to start speech recognition:', e);
      setIsListening(false);
    }
  }, [handleProcessSpeech, toast]);

  const stopSpeaking = useCallback(() => {
    if (synthRef.current) {
      try { synthRef.current.cancel(); } catch (e) {}
    }
    setIsSpeaking(false);
    isSpeakingRef.current = false;
    // Resume listening immediately so user can give next command without waiting
    if (isHandsFreeRef.current) {
      setTimeout(() => {
        startListening();
      }, 250);
    }
  }, [startListening]);

  const stopListening = useCallback(() => {
    setIsHandsFree(false);
    isHandsFreeRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (e) {}
      setIsListening(false);
    }
  }, []);

  const toggleListening = () => {
    if (isSpeaking) {
      stopSpeaking();
      return;
    }
    if (isListening) {
      stopListening();
    } else {
      setIsHandsFree(true);
      isHandsFreeRef.current = true;
      startListening();
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-[200] flex flex-col items-end gap-3 select-none">
      {/* Floating Active Dialogue Window */}
      {isOpen && (
        <Card className="w-[340px] sm:w-[415px] shadow-2xl rounded-3xl border-primary/20 backdrop-blur-xl bg-card/95 overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-3.5 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="relative">
                <div className={cn("h-8 w-8 rounded-full flex items-center justify-center font-bold transition-colors", 
                  isListening ? "bg-emerald-600 text-white" : isSpeaking ? "bg-primary text-primary-foreground animate-pulse" : "bg-primary text-primary-foreground")}>
                  <Sparkles className="h-4 w-4" />
                </div>
                {isListening && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </span>
                )}
              </div>
              <div>
                <h4 className="text-xs font-black tracking-tight flex items-center gap-1.5">
                  Sara • 10-Yr Billing Head
                  <Badge variant="outline" className="text-[9px] py-0 px-1.5 font-bold uppercase border-pink-400/40 bg-pink-500/10 text-pink-600 dark:text-pink-400">
                    AI Copilot
                  </Badge>
                </h4>
                <div className="flex items-center gap-2 text-[10px] font-medium">
                  {isListening ? (
                    <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                      <span>Sun rahi hoon...</span>
                      {/* Audio frequency soundwave visualizer */}
                      <div className="flex items-end gap-0.5 h-3 ml-1">
                        <span className="w-0.5 bg-emerald-500 rounded-full animate-[pulse_0.4s_ease-in-out_infinite] h-2" />
                        <span className="w-0.5 bg-emerald-500 rounded-full animate-[pulse_0.6s_ease-in-out_infinite] h-3" />
                        <span className="w-0.5 bg-emerald-500 rounded-full animate-[pulse_0.3s_ease-in-out_infinite] h-1.5" />
                        <span className="w-0.5 bg-emerald-500 rounded-full animate-[pulse_0.5s_ease-in-out_infinite] h-3" />
                      </div>
                    </div>
                  ) : isProcessing ? (
                    <span className="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Sara soch rahi hai...
                    </span>
                  ) : isSpeaking ? (
                    <div className="flex items-center gap-1 text-primary font-bold">
                      <Volume2 className="h-2.5 w-2.5 animate-bounce" />
                      <span>Sara bol rahi hai...</span>
                      <div className="flex items-end gap-0.5 h-3 ml-1">
                        <span className="w-0.5 bg-primary rounded-full animate-[pulse_0.4s_ease-in-out_infinite] h-2" />
                        <span className="w-0.5 bg-primary rounded-full animate-[pulse_0.6s_ease-in-out_infinite] h-3" />
                        <span className="w-0.5 bg-primary rounded-full animate-[pulse_0.3s_ease-in-out_infinite] h-1.5" />
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Mic on karke hands-free bolein</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* Instant Interrupt Button when Sara is speaking */}
              {isSpeaking && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 px-2 text-[10px] rounded-lg gap-1 font-bold animate-pulse cursor-pointer shadow-sm"
                  onClick={stopSpeaking}
                  title="Click to interrupt Sara immediately"
                >
                  <span className="h-2 w-2 rounded-xs bg-white" />
                  <span>Ruko / Stop</span>
                </Button>
              )}

              {/* Hands-free mode toggle button */}
              <Button
                variant={isHandsFree ? "secondary" : "ghost"}
                size="sm"
                className={cn("h-7 px-2 text-[10px] rounded-lg gap-1 font-bold", isHandsFree ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30" : "text-muted-foreground")}
                onClick={() => {
                  const next = !isHandsFree;
                  setIsHandsFree(next);
                  isHandsFreeRef.current = next;
                  if (next && !isListening) startListening();
                }}
                title={isHandsFree ? "Hands-Free Dialogue is ON (Auto-listens after Sara speaks)" : "Click to enable hands-free auto dialogue"}
              >
                <Headphones className="h-3 w-3" />
                <span>{isHandsFree ? "Auto" : "Manual"}</span>
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => setIsMuted(!isMuted)}
                title={isMuted ? "Unmute Voice" : "Mute Voice"}
              >
                {isMuted ? <VolumeX className="h-3.5 w-3.5 text-destructive" /> : <Volume2 className="h-3.5 w-3.5 text-primary" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Active Conversational Subject Banner */}
          {activeSubject && (activeSubject.companyName || activeSubject.billNo) && (
            <div className="px-3.5 py-1.5 bg-blue-500/10 dark:bg-blue-950/40 border-b border-blue-500/20 flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5 font-bold text-blue-600 dark:text-blue-400 truncate">
                <span>🎯 In Context:</span>
                <span className="truncate font-semibold">
                  {activeSubject.companyName || 'Company'}{activeSubject.billNo ? ` (Bill #${activeSubject.billNo})` : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveSubject(null)}
                className="text-[9px] text-muted-foreground hover:text-foreground cursor-pointer underline ml-2 shrink-0 font-medium"
                title="Clear conversational memory"
              >
                Reset
              </button>
            </div>
          )}

          {/* Conversation Transcript Area */}
          <div ref={chatScrollRef} className="p-3.5 max-h-[260px] overflow-y-auto space-y-2.5 text-xs">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={cn(
                  "p-2.5 rounded-2xl max-w-[85%] text-xs leading-relaxed space-y-1 shadow-xs",
                  m.role === 'user'
                    ? "ml-auto bg-primary text-primary-foreground font-medium rounded-br-xs"
                    : "mr-auto bg-muted/70 text-foreground border border-border/40 rounded-bl-xs"
                )}
              >
                <p>{m.text}</p>
                <span className={cn("block text-[8px] opacity-60", m.role === 'user' ? "text-right" : "text-left")}>
                  {m.timestamp}
                </span>
              </div>
            ))}

            {/* Live user transcript indicator while speaking */}
            {transcript && (
              <div className="ml-auto bg-emerald-500/15 text-foreground border border-emerald-500/30 p-2.5 rounded-2xl rounded-br-xs max-w-[85%] text-xs italic flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                <span>"{transcript}..."</span>
              </div>
            )}

            {isProcessing && (
              <div className="mr-auto flex items-center gap-2 text-muted-foreground text-[11px] p-2 bg-muted/40 rounded-xl border border-border/30">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="font-semibold text-primary">Sara processing command & screen update...</span>
              </div>
            )}
          </div>

          {/* Quick Voice Prompt Suggestions */}
          <div className="p-2.5 bg-muted/20 border-t flex flex-wrap gap-1.5">
            {[
              "Metropolitan ka without GST amount?",
              "Uska after GST amount kitna hua?",
              "26 din ke hisab se 2 din absent calculate karo",
              "Transportation 2 trips @ 5000 add karo",
              "Isme se blank row remove karo",
              "Bill save kardo"
            ].map((tip, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleProcessSpeech(tip)}
                disabled={isProcessing}
                className="text-[9px] font-bold px-2 py-1 rounded-lg bg-background hover:bg-primary/10 hover:text-primary border border-border/40 transition-colors text-muted-foreground cursor-pointer disabled:opacity-50"
              >
                ⚡ "{tip}"
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Main Floating Voice Mic Button with glowing pulse */}
      <div className="flex items-center gap-2">
        {/* If Sara is speaking, show instant interrupt button */}
        {isSpeaking && (
          <Button
            variant="destructive"
            size="sm"
            onClick={stopSpeaking}
            className="h-10 px-3.5 rounded-2xl shadow-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground text-xs font-black gap-1.5 animate-bounce cursor-pointer"
            title="Sara ko turant chup karayein aur bolein"
          >
            <VolumeX className="h-4 w-4" />
            <span>Ruko (Stop)</span>
          </Button>
        )}

        {!isOpen && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setIsOpen(true); if (!isListening) { setIsHandsFree(true); isHandsFreeRef.current = true; startListening(); } }}
            className="h-10 px-3.5 rounded-2xl shadow-xl border-primary/30 bg-background/95 backdrop-blur-md text-xs font-black gap-2 hover:bg-primary/10 cursor-pointer"
          >
            <Sparkles className="h-4 w-4 text-pink-500 animate-pulse" />
            <span>Sara Assistant</span>
            {activeSubject?.companyName && (
              <Badge variant="outline" className="text-[9px] py-0 px-1 font-bold text-blue-600 dark:text-blue-400 border-blue-500/40">
                {activeSubject.companyName.slice(0, 10)}...
              </Badge>
            )}
            <Badge variant="secondary" className="text-[9px] py-0 px-1 font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">Hands-free</Badge>
          </Button>
        )}

        <button
          type="button"
          onClick={toggleListening}
          className={cn(
            "relative h-14 w-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 active:scale-95 cursor-pointer",
            isListening
              ? "bg-emerald-600 text-white shadow-emerald-500/50 scale-105"
              : isSpeaking
              ? "bg-primary text-primary-foreground shadow-primary/50"
              : isProcessing
              ? "bg-amber-500 text-white shadow-amber-500/50 animate-bounce"
              : "bg-primary text-primary-foreground shadow-primary/40 hover:scale-105"
          )}
          title={isSpeaking ? "Click to stop Sara speaking" : isListening ? "Listening... (Click to pause)" : "Click to speak hands-free with Sara"}
        >
          {/* Pulsating glowing rings when listening */}
          {isListening && (
            <>
              <span className="absolute -inset-1 rounded-full bg-emerald-500 opacity-40 animate-ping"></span>
              <span className="absolute -inset-3 rounded-full border-2 border-emerald-500/60 animate-pulse"></span>
            </>
          )}

          {isProcessing ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : isSpeaking ? (
            <Volume2 className="h-6 w-6 animate-bounce" />
          ) : isListening ? (
            <Mic className="h-6 w-6 animate-pulse" />
          ) : (
            <Mic className="h-6 w-6" />
          )}
        </button>
      </div>
    </div>
  );
}
