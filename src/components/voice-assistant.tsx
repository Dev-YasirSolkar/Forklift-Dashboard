
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Loader2, Sparkles, X, Wand2 } from 'lucide-react';
import { processVoiceCommand } from '@/ai/flows/voice-command-flow';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

/**
 * @fileOverview Floating AI Voice Assistant Component.
 * Uses Web Speech API for transcription and Genkit for command parsing.
 */

export function VoiceAssistant() {
  const { toast } = useToast();
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-IN'; // Supports Indian accents better

      recognition.onresult = (event: any) => {
        const current = event.resultIndex;
        const text = event.results[current][0].transcript;
        setTranscript(text);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech Recognition Error:', event.error);
        setIsListening(false);
        if (event.error !== 'no-speech') {
            toast({ variant: 'destructive', title: 'Mic Error', description: `Could not access microphone: ${event.error}` });
        }
      };

      recognitionRef.current = recognition;
    }
  }, [toast]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setTranscript('');
      setIsOpen(true);
      setIsListening(true);
      recognitionRef.current?.start();
    }
  };

  const handleProcessCommand = async () => {
    if (!transcript.trim() || isProcessing) return;

    setIsProcessing(true);
    try {
      const result = await processVoiceCommand({ text: transcript });
      
      if (result.intent !== 'unknown') {
        // Dispatch a custom event for pages to listen to
        const event = new CustomEvent('ai-form-fill', { detail: result });
        window.dispatchEvent(event);
        
        toast({
          title: 'AI Smart Fill',
          description: result.explanation || 'Form data has been pre-filled.',
        });
        setIsOpen(false);
      } else {
        toast({
          variant: 'destructive',
          title: 'Command not understood',
          description: 'Try saying something like "Create invoice for Bisleri".',
        });
      }
    } catch (error) {
      console.error('AI Processing Error:', error);
      toast({ variant: 'destructive', title: 'AI Error', description: 'Failed to process voice command.' });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!recognitionRef.current) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-3 print:hidden">
      {isOpen && (
        <Card className="w-72 sm:w-80 p-4 border-2 shadow-2xl animate-in slide-in-from-bottom-4 duration-300 rounded-3xl overflow-hidden bg-background/95 backdrop-blur-md">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Voice Assistant</span>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => setIsOpen(false)}>
                <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="min-h-[60px] p-3 rounded-2xl bg-muted/30 border border-dashed border-primary/20 mb-4">
            <p className={cn(
                "text-sm font-medium leading-relaxed",
                !transcript && "text-muted-foreground italic"
            )}>
              {transcript || (isListening ? "Listening..." : "Waiting for command...")}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button 
                variant={isListening ? "destructive" : "default"} 
                className="flex-1 rounded-xl font-bold h-10 gap-2"
                onClick={toggleListening}
            >
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {isListening ? "Stop" : "Record"}
            </Button>
            <Button 
                disabled={!transcript || isListening || isProcessing}
                className="flex-1 rounded-xl font-bold h-10 gap-2 bg-primary shadow-lg shadow-primary/20"
                onClick={handleProcessCommand}
            >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Fill Form
            </Button>
          </div>
        </Card>
      )}

      <Button
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "h-14 w-14 rounded-full shadow-2xl transition-all duration-300 hover:scale-110 active:scale-95",
          isListening ? "bg-destructive animate-pulse" : "bg-primary"
        )}
      >
        {isListening ? <Mic className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
      </Button>
    </div>
  );
}
