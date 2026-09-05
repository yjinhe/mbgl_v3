import { BlockList, isIP } from 'node:net';

const internalProxies = new BlockList();
internalProxies.addSubnet('127.0.0.0', 8, 'ipv4');
internalProxies.addSubnet('10.0.0.0', 8, 'ipv4');
internalProxies.addSubnet('172.16.0.0', 12, 'ipv4');
internalProxies.addSubnet('192.168.0.0', 16, 'ipv4');
internalProxies.addAddress('::1', 'ipv6');
internalProxies.addSubnet('fc00::', 7, 'ipv6');

// The supported deployment exposes the API only on loopback and a private
// Docker network. Validate each proxy address as well as the hop limit;
// hop-count-only trust would allow a direct public peer to forge client IPs.
export function proxyTrust(hops: number): false | ((address: string, hop: number) => boolean) {
  if (hops === 0) return false;
  return (address, hop) => {
    if (hop >= hops) return false;
    const family = isIP(address);
    return family !== 0 && internalProxies.check(address, family === 4 ? 'ipv4' : 'ipv6');
  };
}
