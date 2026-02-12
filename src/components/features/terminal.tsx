'use client';

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useTerminal, type TerminalEntry } from '@/hooks/use-terminal';
import { Loader2, Trash2, GripHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProjectTerminalProps {
    projectId: string;
    containerName: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_HEIGHT = 150;
const MAX_HEIGHT = 700;
const DEFAULT_HEIGHT = 320;

// ---------------------------------------------------------------------------
// Slash command definitions (mirrored from backend for autocomplete)
// ---------------------------------------------------------------------------

interface SlashCommand {
    name: string;
    description: string;
    icon: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
    { name: '/show-logs', description: 'Show full application logs', icon: '📋' },
    { name: '/tail-logs', description: 'Tail the last 100 lines of logs', icon: '📜' },
    { name: '/env', description: 'Show all environment variables', icon: '🔧' },
    // { name: '/processes', description: 'List running processes', icon: '⚙️' },
    // { name: '/disk', description: 'Show disk usage summary', icon: '💾' },
    // { name: '/memory', description: 'Show memory usage', icon: '🧠' },
    // { name: '/network', description: 'Show network configuration', icon: '🌐' },
    // { name: '/ports', description: 'Show listening ports', icon: '🔌' },
    // { name: '/system', description: 'Show system info', icon: '🖥️' },
    { name: '/files', description: 'List files in app directory', icon: '📁' },
    { name: '/help', description: 'Show all available commands', icon: '❓' },
];

// ---------------------------------------------------------------------------
// TerminalLine – robbyrussell theme output
// ---------------------------------------------------------------------------

function TerminalLine({ entry, isLast }: { entry: TerminalEntry; isLast: boolean }) {
    const arrowColor = entry.exitCode === 0 ? 'text-green-400' : 'text-red-400';
    const isSlashCmd = entry.command.startsWith('/');

    return (
        <div className="group">
            {/* Command prompt – robbyrussell style */}
            <div className="flex items-start gap-0">
                <span className={cn('select-none font-bold shrink-0', arrowColor)}>➜</span>
                <span className="text-cyan-400 ml-2 shrink-0">~</span>
                <span className={cn('ml-2 break-all', isSlashCmd ? 'text-violet-400 font-semibold' : 'text-gray-200')}>
                    {entry.command}
                </span>
            </div>

            {/* Stdout */}
            {entry.stdout && (
                <pre className="whitespace-pre-wrap break-all text-gray-300 pl-6 mt-0.5 text-[13px] leading-relaxed">
                    {entry.stdout}
                </pre>
            )}

            {/* Stderr */}
            {entry.stderr && (
                <pre
                    className={cn(
                        'whitespace-pre-wrap break-all pl-6 mt-0.5 text-[13px] leading-relaxed',
                        entry.isError ? 'text-red-400' : 'text-yellow-300',
                    )}
                >
                    {entry.stderr}
                </pre>
            )}

            {/* Separator */}
            {!isLast && <div className="border-b border-zinc-800 mt-2 mb-1" />}
        </div>
    );
}

// ---------------------------------------------------------------------------
// SlashCommandMenu – autocomplete dropdown
// ---------------------------------------------------------------------------

function SlashCommandMenu({
    filter,
    selectedIndex,
    onSelect,
}: {
    filter: string;
    selectedIndex: number;
    onSelect: (name: string) => void;
}) {
    const matches = useMemo(() => {
        const q = filter.toLowerCase();
        return SLASH_COMMANDS.filter((c) => c.name.toLowerCase().includes(q));
    }, [filter]);

    if (matches.length === 0) return null;

    return (
        <div className="absolute bottom-full left-0 right-0 mb-1 mx-2 rounded-lg border border-zinc-600/60 bg-[#24283b] shadow-xl overflow-hidden z-50 backdrop-blur-sm">
            <div className="px-3 py-1.5 border-b border-zinc-700/40">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                    Commands
                </span>
            </div>
            <div className="max-h-[240px] overflow-y-auto py-1">
                {matches.map((cmd, i) => (
                    <button
                        key={cmd.name}
                        type="button"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            onSelect(cmd.name);
                        }}
                        className={cn(
                            'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                            i === selectedIndex
                                ? 'bg-violet-500/15 text-violet-300'
                                : 'text-zinc-300 hover:bg-zinc-700/40',
                        )}
                    >
                        <span className="text-base shrink-0 w-5 text-center">{cmd.icon}</span>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                                <span className={cn(
                                    'font-mono text-sm font-semibold',
                                    i === selectedIndex ? 'text-violet-300' : 'text-cyan-400',
                                )}>
                                    {cmd.name}
                                </span>
                            </div>
                            <p className="text-xs text-zinc-500 truncate mt-0.5">{cmd.description}</p>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// useResizable – drag-to-resize hook
// ---------------------------------------------------------------------------

function useResizable(initialHeight: number) {
    const [height, setHeight] = useState(initialHeight);
    const isDragging = useRef(false);
    const startY = useRef(0);
    const startHeight = useRef(0);

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isDragging.current = true;
        startY.current = e.clientY;
        startHeight.current = height;

        const onMouseMove = (ev: MouseEvent) => {
            if (!isDragging.current) return;
            const delta = ev.clientY - startY.current;
            const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight.current + delta));
            setHeight(newHeight);
        };

        const onMouseUp = () => {
            isDragging.current = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    }, [height]);

    return { height, onMouseDown };
}

// ---------------------------------------------------------------------------
// ProjectTerminal
// ---------------------------------------------------------------------------

export function ProjectTerminal({ projectId, containerName }: ProjectTerminalProps) {
    const { history, isExecuting, execute, clearHistory } = useTerminal(projectId);

    const [input, setInput] = useState('');
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [slashMenuIndex, setSlashMenuIndex] = useState(0);
    const [showSlashMenu, setShowSlashMenu] = useState(false);

    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const { height, onMouseDown } = useResizable(DEFAULT_HEIGHT);

    // Collect unique commands for arrow-key navigation
    const commandHistory = history.map((e) => e.command);

    // Determine slash-menu filter
    const slashFilter = useMemo(() => {
        if (!showSlashMenu) return '';
        return input.startsWith('/') ? input : '';
    }, [showSlashMenu, input]);

    // Filtered slash commands for keyboard nav
    const filteredCommands = useMemo(() => {
        const q = slashFilter.toLowerCase();
        return SLASH_COMMANDS.filter((c) => c.name.toLowerCase().includes(q));
    }, [slashFilter]);

    // Show or hide slash menu based on input
    useEffect(() => {
        if (input.startsWith('/') && !isExecuting) {
            setShowSlashMenu(true);
            setSlashMenuIndex(0);
        } else {
            setShowSlashMenu(false);
        }
    }, [input, isExecuting]);

    // Auto-scroll to bottom when history updates
    useEffect(() => {
        const el = scrollRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }, [history, isExecuting]);

    // Focus the input on mount and after every command finishes executing
    useEffect(() => {
        if (!isExecuting) {
            inputRef.current?.focus();
        }
    }, [isExecuting]);

    const selectSlashCommand = useCallback((name: string) => {
        setInput(name + ' ');
        setShowSlashMenu(false);
        inputRef.current?.focus();
    }, []);

    const handleSubmit = useCallback(
        (e: React.FormEvent) => {
            e.preventDefault();
            const trimmed = input.trim();
            if (!trimmed || isExecuting) return;

            // If slash menu is open and a command is highlighted, select it instead
            if (showSlashMenu && filteredCommands.length > 0) {
                const selected = filteredCommands[slashMenuIndex];
                if (selected && trimmed === slashFilter && trimmed.length < selected.name.length) {
                    selectSlashCommand(selected.name);
                    return;
                }
            }

            setShowSlashMenu(false);

            // Handle local "clear" command
            if (trimmed === 'clear') {
                clearHistory();
                setInput('');
                setHistoryIndex(-1);
                return;
            }

            void execute(trimmed);
            setInput('');
            setHistoryIndex(-1);
        },
        [input, isExecuting, execute, clearHistory, showSlashMenu, filteredCommands, slashMenuIndex, slashFilter, selectSlashCommand],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            // Slash menu keyboard navigation
            if (showSlashMenu && filteredCommands.length > 0) {
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSlashMenuIndex((prev) => (prev <= 0 ? filteredCommands.length - 1 : prev - 1));
                    return;
                }
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSlashMenuIndex((prev) => (prev >= filteredCommands.length - 1 ? 0 : prev + 1));
                    return;
                }
                if (e.key === 'Tab') {
                    e.preventDefault();
                    const selected = filteredCommands[slashMenuIndex];
                    if (selected) {
                        selectSlashCommand(selected.name);
                    }
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowSlashMenu(false);
                    return;
                }
            }

            // Command history navigation
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (commandHistory.length === 0) return;
                const nextIdx =
                    historyIndex === -1
                        ? commandHistory.length - 1
                        : Math.max(0, historyIndex - 1);
                setHistoryIndex(nextIdx);
                setInput(commandHistory[nextIdx]);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (historyIndex === -1) return;
                const nextIdx = historyIndex + 1;
                if (nextIdx >= commandHistory.length) {
                    setHistoryIndex(-1);
                    setInput('');
                } else {
                    setHistoryIndex(nextIdx);
                    setInput(commandHistory[nextIdx]);
                }
            }
        },
        [commandHistory, historyIndex, showSlashMenu, filteredCommands, slashMenuIndex, selectSlashCommand],
    );

    // Last exit code for current prompt arrow color
    const lastExitCode = history.length > 0 ? history[history.length - 1].exitCode : 0;
    const promptArrowColor = lastExitCode === 0 ? 'text-green-400' : 'text-red-400';

    return (
        <div className="rounded-lg border border-zinc-700 bg-[#1a1b26] overflow-hidden shadow-lg">
            {/* Header – dark title bar */}
            <div className="flex items-center justify-between px-3 py-2 bg-[#24283b] border-b border-zinc-700/60">
                <div className="flex items-center gap-2">
                    <div className="flex gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-[#f7768e]" />
                        <div className="w-3 h-3 rounded-full bg-[#e0af68]" />
                        <div className="w-3 h-3 rounded-full bg-[#9ece6a]" />
                    </div>
                    <span className="text-xs text-zinc-400 font-mono ml-2">
                        {containerName}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={clearHistory}
                    className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 rounded hover:bg-zinc-700/50"
                    title="Clear terminal"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>

            {/* Output area */}
            <div
                ref={scrollRef}
                style={{ height }}
                onClick={() => inputRef.current?.focus()}
                className="px-4 py-3 overflow-y-auto font-mono text-sm space-y-2 bg-[#1a1b26] scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent"
            >
                {/* Welcome message */}
                {history.length === 0 && !isExecuting && (
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                            <span className="text-green-400 font-bold">➜</span>
                            <span className="text-cyan-400">~</span>
                            <span className="text-zinc-500 text-xs italic">connected to {containerName}</span>
                        </div>
                        <div className="text-zinc-500 text-xs pl-6 space-y-0.5">
                            <p>Type a command and press Enter. Use ↑/↓ to navigate history.</p>
                            <p>Type <span className="text-violet-400 font-semibold">/</span> to see available slash commands.</p>
                            <p>Type <span className="text-cyan-400 font-semibold">clear</span> to reset the terminal.</p>
                        </div>
                    </div>
                )}

                {history.map((entry, i) => (
                    <TerminalLine key={entry.id} entry={entry} isLast={i === history.length - 1} />
                ))}

                {isExecuting && (
                    <div className="flex items-center gap-2 text-zinc-400 pl-1">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                        <span className="text-xs text-zinc-500">executing…</span>
                    </div>
                )}
            </div>

            {/* Input area (relative for slash menu positioning) */}
            <div className="relative">
                {/* Slash command autocomplete */}
                {showSlashMenu && (
                    <SlashCommandMenu
                        filter={slashFilter}
                        selectedIndex={slashMenuIndex}
                        onSelect={selectSlashCommand}
                    />
                )}

                {/* Input */}
                <form
                    onSubmit={handleSubmit}
                    className="flex items-center gap-0 px-4 py-2.5 border-t border-zinc-700/60 bg-[#1a1b26]"
                >
                    <span className={cn('select-none font-bold font-mono text-sm shrink-0', promptArrowColor)}>➜</span>
                    <span className="text-cyan-400 font-mono text-sm ml-2 shrink-0">~</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => {
                            setInput(e.target.value);
                            setHistoryIndex(-1);
                        }}
                        onKeyDown={handleKeyDown}
                        disabled={isExecuting}
                        placeholder="type command or / for shortcuts…"
                        autoComplete="off"
                        spellCheck={false}
                        className={cn(
                            'flex-1 bg-transparent outline-none text-sm font-mono ml-2',
                            input.startsWith('/') ? 'text-violet-400' : 'text-gray-200',
                            'placeholder:text-zinc-600 disabled:opacity-50',
                        )}
                    />
                </form>
            </div>

            {/* Resize handle */}
            <div
                onMouseDown={onMouseDown}
                className="flex items-center justify-center py-1 cursor-ns-resize bg-[#24283b] border-t border-zinc-700/60 hover:bg-zinc-700/40 transition-colors group"
                title="Drag to resize"
            >
                <GripHorizontal className="h-3.5 w-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
            </div>
        </div>
    );
}
