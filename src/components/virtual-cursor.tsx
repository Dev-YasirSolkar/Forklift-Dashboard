'use client';

import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface VirtualCursorRef {
  glideToAndClick: (
    targetOrSelector: string | HTMLElement,
    label?: string,
    options?: {
      hoverDelay?: number;
      clickDelay?: number;
      settleDelay?: number;
      scrollIntoView?: boolean;
    }
  ) => Promise<boolean>;
  glideTo: (
    x: number,
    y: number,
    label?: string,
    duration?: number
  ) => Promise<void>;
  showStatus: (text: string, type?: 'success' | 'info' | 'error') => void;
  hide: () => void;
  getPos: () => { x: number; y: number };
}

export const VirtualCursor = forwardRef<VirtualCursorRef, { initialX?: number; initialY?: number }>(
  ({ initialX, initialY }, ref) => {
    const [pos, setPos] = useState({ x: initialX ?? 100, y: initialY ?? 100 });
    const [isVisible, setIsVisible] = useState(false);
    const [isClicking, setIsClicking] = useState(false);
    const [isHovering, setIsHovering] = useState(false);
    const [statusLabel, setStatusLabel] = useState<string | null>(null);
    const [statusType, setStatusType] = useState<'success' | 'info' | 'error'>('info');

    const posRef = useRef({ x: initialX ?? 100, y: initialY ?? 100 });
    const animFrameRef = useRef<number | null>(null);
    const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Keep ref in sync
    useEffect(() => {
      posRef.current = pos;
    }, [pos]);

    // Natural cubic ease-in-out
    const easeInOutCubic = (t: number): number => {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    };

    const hide = useCallback(() => {
      setIsVisible(false);
      setStatusLabel(null);
    }, []);

    const showStatus = useCallback((text: string, type: 'success' | 'info' | 'error' = 'info') => {
      setIsVisible(true);
      setStatusLabel(text);
      setStatusType(type);
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = setTimeout(() => {
        setIsVisible(false);
      }, 1500);
    }, []);

    const glideTo = useCallback(
      (targetX: number, targetY: number, label?: string, customDuration?: number): Promise<void> => {
        return new Promise((resolve) => {
          if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
          setIsVisible(true);
          setIsClicking(false);
          setIsHovering(false);
          if (label) {
            setStatusLabel(label);
            setStatusType('info');
          }

          const startX = posRef.current.x;
          const startY = posRef.current.y;
          const dist = Math.hypot(targetX - startX, targetY - startY);

          // Dynamic duration: minimum 320ms, max 700ms
          const duration = customDuration ?? Math.min(680, Math.max(340, dist * 0.75));

          // Curved trajectory: calculate perpendicular offset for natural hand arc
          const midX = (startX + targetX) / 2;
          const midY = (startY + targetY) / 2;
          // Perpendicular offset based on distance
          const perpFactor = Math.min(40, Math.max(-40, (dist * 0.12) * (startX > targetX ? 1 : -1)));
          const angle = Math.atan2(targetY - startY, targetX - startX);
          const controlX = midX - Math.sin(angle) * perpFactor;
          const controlY = midY + Math.cos(angle) * perpFactor;

          const startTime = performance.now();

          const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(1, elapsed / duration);
            const t = easeInOutCubic(progress);

            // Quadratic Bezier interpolation: B(t) = (1-t)^2 * P0 + 2*(1-t)*t * P1 + t^2 * P2
            const currentX = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * controlX + t * t * targetX;
            const currentY = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * targetY;

            posRef.current = { x: currentX, y: currentY };
            setPos({ x: currentX, y: currentY });

            if (progress < 1) {
              animFrameRef.current = requestAnimationFrame(animate);
            } else {
              posRef.current = { x: targetX, y: targetY };
              setPos({ x: targetX, y: targetY });
              resolve();
            }
          };

          if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = requestAnimationFrame(animate);
        });
      },
      []
    );

    const glideToAndClick = useCallback(
      async (
        targetOrSelector: string | HTMLElement,
        label?: string,
        options?: {
          hoverDelay?: number;
          clickDelay?: number;
          settleDelay?: number;
          scrollIntoView?: boolean;
        }
      ): Promise<boolean> => {
        let el: HTMLElement | null = null;
        if (typeof targetOrSelector === 'string') {
          // Try by id first, then selector
          el = document.getElementById(targetOrSelector) ||
               document.querySelector<HTMLElement>(targetOrSelector) ||
               document.getElementById(targetOrSelector.replace(/^#/, ''));
        } else {
          el = targetOrSelector;
        }

        if (!el) {
          console.warn('[VirtualCursor] Target element not found:', targetOrSelector);
          return false;
        }

        // Auto-scroll if offscreen or partially hidden
        if (options?.scrollIntoView !== false) {
          const rect = el.getBoundingClientRect();
          const isOffscreen = rect.top < 60 || rect.bottom > window.innerHeight - 60 || rect.left < 20 || rect.right > window.innerWidth - 20;
          if (isOffscreen) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            await new Promise((r) => setTimeout(r, 260));
          }
        }

        // Get accurate target position (center of element with slight natural variance)
        const rect = el.getBoundingClientRect();
        const targetX = Math.round(rect.left + rect.width / 2);
        const targetY = Math.round(rect.top + rect.height / 2);

        // Glide smoothly to target
        await glideTo(targetX, targetY, label);

        // Hover hesitation (human reaction time)
        setIsHovering(true);
        // Highlight element with a temporary subtle aura
        el.classList.add('ring-2', 'ring-indigo-500', 'ring-offset-2', 'transition-all', 'duration-150');

        await new Promise((r) => setTimeout(r, options?.hoverDelay ?? 160));

        // Click down animation
        setIsClicking(true);

        // Dispatch realistic mouse events to element
        try {
          const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: targetX,
            clientY: targetY,
          });
          el.dispatchEvent(clickEvent);
          // If it's a focusable input or button
          if (typeof el.focus === 'function') {
            el.focus();
          }
        } catch (e) {
          console.error('[VirtualCursor] Click dispatch error:', e);
        }

        await new Promise((r) => setTimeout(r, options?.clickDelay ?? 180));

        // Release click
        setIsClicking(false);
        setIsHovering(false);
        el.classList.remove('ring-2', 'ring-indigo-500', 'ring-offset-2');

        // Settle delay before next action
        await new Promise((r) => setTimeout(r, options?.settleDelay ?? 140));

        return true;
      },
      [glideTo]
    );

    useImperativeHandle(
      ref,
      () => ({
        glideToAndClick,
        glideTo,
        showStatus,
        hide,
        getPos: () => posRef.current,
      }),
      [glideToAndClick, glideTo, showStatus, hide]
    );

    if (!isVisible) return null;

    return (
      <div
        className="fixed top-0 left-0 pointer-events-none z-[9999999]"
        style={{
          transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
          willChange: 'transform',
        }}
        aria-hidden="true"
      >
        {/* Click Ripple Wave (Radiating expanding ring on click) */}
        {isClicking && (
          <div className="absolute -top-4 -left-4 w-9 h-9 rounded-full border-2 border-indigo-400 bg-indigo-500/25 animate-ping" />
        )}

        {/* Hover Aura */}
        {isHovering && !isClicking && (
          <div className="absolute -top-3 -left-3 w-7 h-7 rounded-full bg-indigo-400/20 blur-sm animate-pulse" />
        )}

        {/* Cursor Pointer Graphic */}
        <div
          className={cn(
            'relative origin-top-left transition-transform duration-100 ease-out',
            isClicking ? 'scale-[0.84]' : isHovering ? 'scale-105' : 'scale-100'
          )}
        >
          {/* macOS / Cyberpunk AI Stylized Cursor Arrow */}
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="filter drop-shadow-[0_4px_10px_rgba(79,70,229,0.55)]"
          >
            <path
              d="M3 2L20 10.5L11.5 13L8 21.5L3 2Z"
              fill="#0F172A"
              stroke="#818CF8"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>

          {/* Neon Center Dot at Arrow Tip */}
          <div className="absolute top-[2px] left-[2px] w-1.5 h-1.5 rounded-full bg-indigo-300 animate-pulse shadow-sm shadow-indigo-400" />

          {/* Human Action Pill / Badge */}
          {statusLabel && (
            <div
              className={cn(
                'absolute left-6 top-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full shadow-2xl backdrop-blur-md whitespace-nowrap animate-in fade-in zoom-in-95 duration-150 border',
                statusType === 'success'
                  ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
                  : statusType === 'error'
                  ? 'bg-rose-950/90 border-rose-500/40 text-rose-200'
                  : 'bg-slate-900/95 border-indigo-500/40 text-slate-100'
              )}
            >
              <span
                className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  statusType === 'success'
                    ? 'bg-emerald-400'
                    : statusType === 'error'
                    ? 'bg-rose-400'
                    : 'bg-indigo-400 animate-ping'
                )}
              />
              <span className="text-[11px] font-bold tracking-tight">{statusLabel}</span>
            </div>
          )}
        </div>
      </div>
    );
  }
);

VirtualCursor.displayName = 'VirtualCursor';
