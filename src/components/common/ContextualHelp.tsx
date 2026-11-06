/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { HelpCircle, X, Sparkles, CheckCircle2 } from 'lucide-react';

interface ContextualHelpProps {
  id: string; // unique key for localStorage
  title: string;
  description: string;
  bulletPoints?: string[];
  className?: string;
  defaultExpanded?: boolean;
}

export function ContextualHelp({
  id,
  title,
  description,
  bulletPoints,
  className = '',
  defaultExpanded = false,
}: ContextualHelpProps) {
  const [isDismissed, setIsDismissed] = useState(true);
  const [isOpen, setIsOpen] = useState(defaultExpanded);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(`syncview_help_dismissed_${id}`);
      if (dismissed === 'true') {
        setIsDismissed(true);
        setIsOpen(false);
      } else {
        setIsDismissed(false);
      }
    } catch {
      setIsDismissed(false);
    }
  }, [id]);

  const handleDismissForever = () => {
    try {
      localStorage.setItem(`syncview_help_dismissed_${id}`, 'true');
    } catch {}
    setIsDismissed(true);
    setIsOpen(false);
  };

  if (isDismissed) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        title={`Help: ${title}`}
        className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-indigo-400 transition-colors py-1 px-2 rounded-md hover:bg-slate-800/60"
        aria-label={`Open help for ${title}`}
      >
        <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
        <span>Help</span>
      </button>
    );
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-300 hover:text-indigo-200 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 px-2.5 py-1 rounded-full transition-all"
        aria-label={`Open guide: ${title}`}
      >
        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
        <span>Quick Tip: {title}</span>
      </button>
    );
  }

  return (
    <div
      role="region"
      aria-label={title}
      className={`relative bg-gradient-to-br from-slate-900/95 via-indigo-950/30 to-slate-900/95 border border-indigo-500/30 rounded-xl p-4 shadow-xl shadow-black/40 backdrop-blur-md text-sm text-slate-200 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <h4 className="font-semibold text-white text-sm">{title}</h4>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Minimize tip"
            aria-label="Minimize tip"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-300 leading-relaxed">{description}</p>

      {bulletPoints && bulletPoints.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {bulletPoints.map((point, idx) => (
            <li key={idx} className="flex items-start gap-2 text-xs text-slate-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3.5 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-xs">
        <button
          onClick={handleDismissForever}
          className="text-slate-400 hover:text-slate-200 underline underline-offset-2 transition-colors cursor-pointer"
        >
          Don't show again
        </button>
        <button
          onClick={() => setIsOpen(false)}
          className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-medium transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
