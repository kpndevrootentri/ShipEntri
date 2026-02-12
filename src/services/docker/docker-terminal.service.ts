/**
 * Docker terminal service: execute commands inside running containers.
 * Uses dockerode's container.exec() to run commands and capture output.
 */

import Docker from 'dockerode';
import { getConfig } from '@/lib/config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerminalExecResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export interface SlashCommandDef {
    name: string;
    description: string;
    /** The shell command to run inside (or outside) the container. */
    resolve: (containerName: string, args: string) => string;
    /** If true, run on the host Docker daemon instead of inside the container. */
    hostCommand?: boolean;
}

// ---------------------------------------------------------------------------
// Slash command registry
// ---------------------------------------------------------------------------

export const SLASH_COMMANDS: SlashCommandDef[] = [
    {
        name: '/show-logs',
        description: 'Show full application logs',
        resolve: () => '__DOCKER_LOGS__:500',
        hostCommand: true,
    },
    {
        name: '/tail-logs',
        description: 'Tail the last 100 lines of logs',
        resolve: () => '__DOCKER_LOGS__:100',
        hostCommand: true,
    },
    {
        name: '/env',
        description: 'Show all environment variables',
        resolve: () => 'env | sort',
    },
    // {
    //     name: '/processes',
    //     description: 'List running processes',
    //     resolve: () => 'ps aux 2>/dev/null || ps -ef',
    // },
    // {
    //     name: '/disk',
    //     description: 'Show disk usage summary',
    //     resolve: () => 'df -h && echo "" && du -sh /* 2>/dev/null | sort -rh | head -10',
    // },
    // {
    //     name: '/memory',
    //     description: 'Show memory usage',
    //     resolve: () => 'free -h 2>/dev/null || cat /proc/meminfo | head -5',
    // },
    // {
    //     name: '/network',
    //     description: 'Show network configuration',
    //     resolve: () => 'ifconfig 2>/dev/null || ip addr 2>/dev/null || cat /etc/hosts',
    // },
    // {
    //     name: '/ports',
    //     description: 'Show listening ports',
    //     resolve: () => 'netstat -tlnp 2>/dev/null || ss -tlnp 2>/dev/null || echo "No network tools available"',
    // },
    // {
    //     name: '/system',
    //     description: 'Show system info (OS, hostname, uptime)',
    //     resolve: () => 'echo "Hostname: $(hostname)" && echo "OS: $(uname -a)" && echo "Uptime: $(uptime)"',
    // },
    {
        name: '/files',
        description: 'List files in the application directory',
        resolve: () => 'ls -la',
    },
    {
        name: '/help',
        description: 'Show all available slash commands',
        resolve: () => 'echo "__SLASH_HELP__"',
    },
];

// ---------------------------------------------------------------------------
// Allowed commands (safety allowlist)
// ---------------------------------------------------------------------------

const ALLOWED_COMMANDS = new Set([
    'ls', 'cat', 'pwd', 'echo', 'env', 'whoami',
    'df', 'du', 'ps', 'top', 'head', 'tail',
    'grep', 'find', 'wc', 'date', 'uptime',
    'which', 'printenv', 'hostname', 'uname',
    'id', 'free', 'stat', 'file', 'sort', 'uniq',
    'tr', 'cut', 'awk', 'sed', 'less', 'more',
    'mkdir', 'touch', 'cp', 'mv', 'cd',
    'npm', 'node', 'python', 'pip',
    'curl', 'wget',
]);

const EXEC_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DockerTerminalService {
    private docker: Docker;

    constructor (socketPath?: string) {
        const resolvedSocket =
            socketPath ?? getConfig().DOCKER_SOCKET ?? '/var/run/docker.sock';
        this.docker = new Docker({ socketPath: resolvedSocket });
    }

    /**
     * Validate that the base command is in the allowlist.
     * The base command is the first token of the input string.
     */
    private validateCommand(command: string): void {
        const trimmed = command.trim();
        if (!trimmed) {
            throw new Error('Command cannot be empty');
        }

        const baseCommand = trimmed.split(/\s+/)[0];
        if (!baseCommand || !ALLOWED_COMMANDS.has(baseCommand)) {
            throw new Error(
                `Command "${baseCommand}" is not allowed. Permitted commands: ${[...ALLOWED_COMMANDS].sort().join(', ')}`
            );
        }
    }

    /**
     * Resolve a container – try by name first, fallback to finding by image.
     */
    private async resolveContainer(containerName: string): Promise<Docker.Container> {
        // 1. Try the expected named container
        try {
            const container = this.docker.getContainer(containerName);
            await container.inspect();
            return container;
        } catch {
            // Not found by name – try image-based lookup
        }

        // 2. Fallback: find a running container whose image matches the slug
        const imageName = containerName.replace(/^dropdeploy-/, 'dropdeploy/') + ':latest';
        const containers = await this.docker.listContainers({ all: false });
        const match = containers.find((c) => c.Image === imageName);
        if (match) {
            return this.docker.getContainer(match.Id);
        }

        throw new Error(
            `Container "${containerName}" not found. Redeploy the project to create a named container.`
        );
    }

    /**
     * Execute a shell command inside the given container and return output.
     */
    async executeCommand(
        containerName: string,
        command: string,
    ): Promise<TerminalExecResult> {
        this.validateCommand(command);
        return this.runInContainer(containerName, command);
    }

    /**
     * Execute a slash command inside the given container.
     */
    async executeSlashCommand(
        containerName: string,
        slashInput: string,
    ): Promise<TerminalExecResult> {
        const parts = slashInput.trim().split(/\s+/);
        const name = parts[0];
        const args = parts.slice(1).join(' ');

        const cmd = SLASH_COMMANDS.find((c) => c.name === name);
        if (!cmd) {
            const available = SLASH_COMMANDS.map((c) => c.name).join(', ');
            throw new Error(`Unknown slash command "${name}". Available: ${available}`);
        }

        // Special: /help returns a formatted list
        if (name === '/help') {
            const helpText = SLASH_COMMANDS
                .filter((c) => c.name !== '/help')
                .map((c) => `  ${c.name.padEnd(16)} ${c.description}`)
                .join('\n');
            return {
                stdout: `Available commands:\n\n${helpText}\n\nType any command or use / to see suggestions.`,
                stderr: '',
                exitCode: 0,
            };
        }

        const resolved = cmd.resolve(containerName, args);

        // Host commands use Docker API directly (e.g. container logs)
        if (cmd.hostCommand && resolved.startsWith('__DOCKER_LOGS__')) {
            const tailLines = parseInt(resolved.split(':')[1] || '100', 10);
            return this.getContainerLogs(containerName, tailLines);
        }

        return this.runInContainer(containerName, resolved);
    }

    /**
     * Fetch container logs via the Docker API (non-blocking).
     */
    private async getContainerLogs(
        containerName: string,
        tailLines: number,
    ): Promise<TerminalExecResult> {
        const container = await this.resolveContainer(containerName);

        const logStream = await container.logs({
            stdout: true,
            stderr: true,
            tail: tailLines,
            follow: false,
            timestamps: true,
        });

        // container.logs with follow:false returns a Buffer (not a stream)
        const raw = typeof logStream === 'string'
            ? logStream
            : Buffer.isBuffer(logStream)
                ? logStream.toString('utf8')
                : '';

        // Docker multiplexes stdout/stderr with 8-byte headers per frame.
        // We demux manually: header[0] = stream type (1=stdout, 2=stderr), bytes 4-7 = payload length.
        const stdout: string[] = [];
        const stderr: string[] = [];
        let offset = 0;
        const buf = typeof logStream === 'string' ? Buffer.from(logStream) : logStream as Buffer;

        if (Buffer.isBuffer(buf) && buf.length > 8) {
            while (offset < buf.length) {
                if (offset + 8 > buf.length) break;
                const streamType = buf[offset];
                const payloadLen = buf.readUInt32BE(offset + 4);
                offset += 8;
                if (offset + payloadLen > buf.length) break;
                const payload = buf.subarray(offset, offset + payloadLen).toString('utf8');
                if (streamType === 2) {
                    stderr.push(payload);
                } else {
                    stdout.push(payload);
                }
                offset += payloadLen;
            }
        } else {
            // Fallback: treat entire output as stdout
            stdout.push(raw);
        }

        const stdoutText = stdout.join('').trim();
        const stderrText = stderr.join('').trim();

        return {
            stdout: stdoutText || '(no logs available)',
            stderr: stderrText,
            exitCode: 0,
        };
    }

    /**
     * Low-level exec inside a container.
     */
    private async runInContainer(
        containerName: string,
        command: string,
    ): Promise<TerminalExecResult> {
        const container = await this.resolveContainer(containerName);

        // Verify the container is running
        const info = await container.inspect();
        if (!info.State.Running) {
            throw new Error('Container is not running');
        }

        const exec = await container.exec({
            Cmd: ['/bin/sh', '-c', command],
            AttachStdout: true,
            AttachStderr: true,
        });

        const stream = await exec.start({ Detach: false, Tty: false });

        return new Promise<TerminalExecResult>((resolve, reject) => {
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];

            const timeout = setTimeout(() => {
                stream.destroy();
                reject(new Error(`Command timed out after ${EXEC_TIMEOUT_MS / 1000}s`));
            }, EXEC_TIMEOUT_MS);

            // dockerode multiplexes stdout/stderr via Docker stream protocol
            this.docker.modem.demuxStream(
                stream,
                {
                    write(chunk: Buffer) {
                        stdoutChunks.push(chunk);
                    },
                } as NodeJS.WritableStream,
                {
                    write(chunk: Buffer) {
                        stderrChunks.push(chunk);
                    },
                } as NodeJS.WritableStream,
            );

            stream.on('end', async () => {
                clearTimeout(timeout);
                try {
                    const inspectResult = await exec.inspect();
                    resolve({
                        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                        stderr: Buffer.concat(stderrChunks).toString('utf8'),
                        exitCode: inspectResult.ExitCode ?? 0,
                    });
                } catch {
                    resolve({
                        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                        stderr: Buffer.concat(stderrChunks).toString('utf8'),
                        exitCode: -1,
                    });
                }
            });

            stream.on('error', (err: Error) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }
}

export const dockerTerminalService = new DockerTerminalService();
