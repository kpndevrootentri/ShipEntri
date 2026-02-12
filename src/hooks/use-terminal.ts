'use client';

import { useCallback, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerminalEntry {
    id: string;
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    timestamp: number;
    /** True if this entry represents a client-side error (e.g. network failure). */
    isError?: boolean;
}

export interface UseTerminalReturn {
    history: TerminalEntry[];
    isExecuting: boolean;
    execute: (command: string) => Promise<void>;
    clearHistory: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

let nextId = 0;

export function useTerminal(projectId: string): UseTerminalReturn {
    const [history, setHistory] = useState<TerminalEntry[]>([]);
    const [isExecuting, setIsExecuting] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    const execute = useCallback(
        async (command: string): Promise<void> => {
            const trimmed = command.trim();
            if (!trimmed) return;

            setIsExecuting(true);
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;

            try {
                const res = await fetch(`/api/projects/${projectId}/terminal`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: trimmed }),
                    signal: controller.signal,
                });

                const json = await res.json();

                const entry: TerminalEntry = {
                    id: String(++nextId),
                    command: trimmed,
                    stdout: json?.data?.stdout ?? '',
                    stderr: json?.data?.stderr ?? json?.error?.message ?? '',
                    exitCode: json?.data?.exitCode ?? (res.ok ? 0 : 1),
                    timestamp: Date.now(),
                    isError: !res.ok,
                };

                setHistory((prev) => [...prev, entry]);
            } catch (err) {
                if ((err as Error).name === 'AbortError') return;
                setHistory((prev) => [
                    ...prev,
                    {
                        id: String(++nextId),
                        command: trimmed,
                        stdout: '',
                        stderr: (err as Error).message || 'Request failed',
                        exitCode: 1,
                        timestamp: Date.now(),
                        isError: true,
                    },
                ]);
            } finally {
                setIsExecuting(false);
            }
        },
        [projectId],
    );

    const clearHistory = useCallback(() => {
        setHistory([]);
    }, []);

    return { history, isExecuting, execute, clearHistory };
}
