import React from 'react';

/**
 * Client-side utility to get the local IP address
 * Uses WebRTC to determine the local network IP
 */
export async function getLocalIP(): Promise<string | null> {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const pc = new RTCPeerConnection({
            iceServers: []
        });

        pc.createDataChannel('');

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        return new Promise<string | null>((resolve) => {
            const timeout = setTimeout(() => {
                pc.close();
                resolve(null);
            }, 2000);

            pc.onicecandidate = (ice) => {
                if (!ice || !ice.candidate || !ice.candidate.candidate) {
                    return;
                }

                const parts = ice.candidate.candidate.split(' ');
                const ip = parts[4];

                console.log("ip", ip)

                // Check if it's a valid IPv4 address and not localhost
                if (ip && ip.match(/^(\d{1,3}\.){3}\d{1,3}$/) && !ip.startsWith('127.')) {
                    clearTimeout(timeout);
                    pc.close();
                    resolve(ip);
                }
            };
        });
    } catch {
        return null;
    }
}

/**
 * Hook to get and cache local IP address
 */
export function useLocalIP() {
    const [localIP, setLocalIP] = React.useState<string | null>(null);

    React.useEffect(() => {
        getLocalIP().then(ip => {
            if (ip) {
                setLocalIP(ip);
            }
        });
    }, []);

    return localIP;
}
