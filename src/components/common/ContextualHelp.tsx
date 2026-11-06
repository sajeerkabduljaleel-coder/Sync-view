/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { HelpCircle, X, CheckCircle2 } from 'lucide-react';

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
  const [isDismissed, setIsDismissed] = useState(false);
  const [isOpen, setIsOpen] = useState(defaultExpanded);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(`syncview_help_dismissed_${id}`);
      if (dismissed === 'true') {
        setIsDismissed(true);
        setIsOpen(false);
      }
    } catch {
      // Ignore localStorage access issues
    }
  }, [id]);

  const handleDismissForever = () => {
    try {
      localStorage.setItem(`syncview_help_dismissed_${id}`, 'true');
    } catch {}
    setIsDismissed(true);
    setIsOpen(false);
  };

  // If permanently dismissed or collapsed, render only a subtle minimal (?) help icon
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        title={`Help: ${title}`}
        className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-slate-400 hover:text-indigo-400 hover:bg-slate-800/80 transition-colors cursor-pointer ${
          isDismissed ? 'opacity-60 hover:opacity-100' : 'opacity-90'
        } ${className}`}
        aria-label={`Show help: ${title}`}
      >
        <HelpCircle className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div
      role="region"
      aria-label={title}
      className={`relative z-20 bg-slate-900/95 border border-indigo-500/30 rounded-xl p-3.5 shadow-xl shadow-black/50 backdrop-blur-md text-xs text-slate-200 max-w-sm ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-indigo-400 shrink-0" />
          <h4 className="font-semibold text-white text-xs">{title}</h4>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          title="Close help"
          aria-label="Close help"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="mt-1.5 text-slate-300 leading-relaxed">{description}</p>

      {bulletPoints && bulletPoints.length > 0 && (
        <ul className="mt-2 space-y-1">
          {bulletPoints.map((point, idx) => (
            <li key={idx} className="flex items-start gap-1.5 text-slate-300">
              <CheckCircle2 className="w-3 h-3 text-indigo-400 shrink-0 mt-0.5" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
        <button
          onClick={handleDismissForever}
          className="text-slate-400 hover:text-slate-200 underline underline-offset-2 transition-colors cursor-pointer"
        >
          Don't show again
        </button>
        <button
          onClick={() => setIsOpen(false)}
          className="px-2.5 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-medium transition-colors cursor-pointer"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
