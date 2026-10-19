'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Mic, MicOff, Volume2, VolumeX, Sparkles, Loader2, X, MessageSquare, ChevronUp, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export interface VoiceAction {
  type: 'OPEN_NEW_FORM' | 'DUPLICATE_INVOICE' | 'SET_FIELD' | 'ADD_LINE_ITEM' | 'UPDATE_LINE_ITEM' | 'REMOVE_LINE_ITEM' | 'SAVE_INVOICE' | 'CLOSE_FORM';
  field?: string;
  value?: any;
  invoiceId?: string;
  companyId?: string;
  newBillDate?: string;
  index?: number;
  particulars?: string;
  rate?: string;
  amount?: number;
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
    items?: Array<{ particulars: string; rate?: string; amount: number }>;
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
    grandTotal: number;
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
  const [transcript, setTranscript] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: `Namaste! Main aapka Voice Billing Assistant hoon. Aap bol kar bill duplicate, naya item (jaise OT, Diesel) add, ya rate badal sakte hain.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Initialize Speech Synthesis
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  // Scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, transcript]);

  // Text to Speech Helper
  const speakResponse = useCallback((text: string, onEnd?: () => void) => {
    if (isMuted || !synthRef.current) {
      if (onEnd) onEnd();
      return;
    }

    try {
      synthRef.current.cancel(); // Stop any ongoing speech
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Look for Hindi or Indian English voices
      const voices = synthRef.current.getVoices();
      const preferredVoice = voices.find(v => v.lang.includes('hi') || v.lang.includes('IN')) || voices[0];
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }
      utterance.rate = 1.05;
      utterance.pitch = 1.0;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        setIsSpeaking(false);
        if (onEnd) onEnd();
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        if (onEnd) onEnd();
      };

      synthRef.current.speak(utterance);
    } catch (e) {
      console.warn('TTS error:', e);
      setIsSpeaking(false);
      if (onEnd) onEnd();
    }
  }, [isMuted]);

  // Send Transcribed Speech to Backend API
  const handleProcessSpeech = useCallback(async (speechText: string) => {
    if (!speechText.trim()) return;

    setIsProcessing(true);
    const userMsg: Message = {
      role: 'user',
      text: speechText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, userMsg]);

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
          currentFormState,
          companies,
          recentInvoices,
          conversationHistory: historyPayload
        })
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Server processing error');
      }

      const assistantMsg: Message = {
        role: 'assistant',
        text: data.spokenResponse || 'Maine updates kar diye hain.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, assistantMsg]);

      // Execute actions step-by-step
      if (Array.isArray(data.actions) && data.actions.length > 0) {
        for (let i = 0; i < data.actions.length; i++) {
          const action = data.actions[i];
          onExecuteAction(action);
          // slight delay between actions for visual satisfaction
          await new Promise(r => setTimeout(r, 120));
        }
      }

      // Speak back the response
      speakResponse(data.spokenResponse, () => {
        // If Gemini asked a clarification question, auto-start listening again!
        if (data.needsUserResponse) {
          startListening();
        }
      });

    } catch (error: any) {
      console.error('Voice Processing Failed:', error);
      const errMsg = "Kuch technical problem aayi hai. Kripya dobara bolein.";
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: errMsg,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
      speakResponse(errMsg);
    } finally {
      setIsProcessing(false);
      setTranscript('');
    }
  }, [activeFirm, currentFormState, companies, recentInvoices, messages, onExecuteAction, speakResponse]);

  // Start Voice Recognition
  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return;

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
        recognitionRef.current.abort();
      }

      const recognition = new SpeechRecognition();
      recognition.lang = 'hi-IN'; // Also understands Hinglish & English
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
        console.warn('Speech recognition error:', event.error);
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

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-[200] flex flex-col items-end gap-3 select-none">
      {/* Floating Active Dialogue Window */}
      {isOpen && (
        <Card className="w-[340px] sm:w-[400px] shadow-2xl rounded-3xl border-primary/20 backdrop-blur-xl bg-card/95 overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-3.5 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="relative">
                <div className={cn("h-8 w-8 rounded-full flex items-center justify-center font-bold", isListening ? "bg-red-500 text-white animate-pulse" : "bg-primary text-primary-foreground")}>
                  <Sparkles className="h-4 w-4" />
                </div>
                {isListening && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                  </span>
                )}
              </div>
              <div>
                <h4 className="text-xs font-black tracking-tight flex items-center gap-1.5">
                  Voice Billing Copilot
                  <Badge variant="outline" className="text-[9px] py-0 px-1.5 font-bold uppercase border-primary/30 text-primary">
                    AI Live
                  </Badge>
                </h4>
                <p className="text-[10px] text-muted-foreground font-medium">
                  {isListening ? 'Suniye jaa raha hai (Listening...)' : isProcessing ? 'Processing command...' : isSpeaking ? 'Speaking...' : 'Ready for voice'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
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

          {/* Conversation Transcript Area */}
          <div ref={chatScrollRef} className="p-3.5 max-h-[260px] overflow-y-auto space-y-2.5 text-xs">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={cn(
                  "p-2.5 rounded-2xl max-w-[85%] text-xs leading-relaxed space-y-1",
                  m.role === 'user'
                    ? "ml-auto bg-primary text-primary-foreground font-semibold rounded-br-xs"
                    : "mr-auto bg-muted/60 text-foreground border rounded-bl-xs"
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
              <div className="ml-auto bg-primary/20 text-foreground border border-primary/30 p-2.5 rounded-2xl rounded-br-xs max-w-[85%] text-xs italic animate-pulse">
                "{transcript}..."
              </div>
            )}

            {isProcessing && (
              <div className="mr-auto flex items-center gap-2 text-muted-foreground text-[11px] p-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span>Computer action execute kar raha hai...</span>
              </div>
            )}
          </div>

          {/* Quick Voice Prompt Suggestions */}
          <div className="p-2.5 bg-muted/20 border-t flex flex-wrap gap-1.5">
            {[
              "JSW ka bill duplicate karo",
              "OT item add karo ₹5000",
              "Date 15 Oct kardo",
              "Advance ₹10,000 daalo"
            ].map((tip, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleProcessSpeech(tip)}
                disabled={isProcessing || isListening}
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
        {!isOpen && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsOpen(true)}
            className="h-9 px-3 rounded-2xl shadow-lg border-primary/20 bg-background/90 backdrop-blur-md text-xs font-bold gap-1.5 hover:bg-primary/5 cursor-pointer"
          >
            <MessageSquare className="h-3.5 w-3.5 text-primary" />
            <span>Voice Assistant</span>
          </Button>
        )}

        <button
          type="button"
          onClick={toggleListening}
          className={cn(
            "relative h-14 w-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 active:scale-95 cursor-pointer",
            isListening
              ? "bg-red-600 text-white shadow-red-500/50 scale-105"
              : isProcessing
              ? "bg-amber-500 text-white shadow-amber-500/50 animate-bounce"
              : "bg-primary text-primary-foreground shadow-primary/40 hover:scale-105"
          )}
          title={isListening ? "Listening... (Click to stop)" : "Click to speak"}
        >
          {/* Pulsating glowing rings when listening */}
          {isListening && (
            <>
              <span className="absolute -inset-1 rounded-full bg-red-500 opacity-40 animate-ping"></span>
              <span className="absolute -inset-3 rounded-full border-2 border-red-500/60 animate-pulse"></span>
            </>
          )}

          {isProcessing ? (
            <Loader2 className="h-6 w-6 animate-spin" />
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
