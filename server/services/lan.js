/*
 * LAN discovery: list active IPv4 addresses so Reception, USG console, Lab PC and doctor
 * phones/tablets on the clinic Wi-Fi/Ethernet can connect (http://<LAN_IP>:<PORT>).
 */
const os = require('os');

function lanAddresses(port) {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    for (const a of list || []) {
      const fam = typeof a.family === 'string' ? a.family : a.family === 4 ? 'IPv4' : 'IPv6';
      if (fam !== 'IPv4' || a.internal) continue;
      if (/^169\.254\./.test(a.address)) continue;
      const virtual = /docker|veth|br-|vmnet|vbox|virtual|hyper-v|wsl|loopback|tailscale|zerotier/i.test(name);
      out.push({ iface: name, address: a.address, url: `http://${a.address}:${port}`, virtual });
    }
  }
  out.sort((x, y) => Number(x.virtual) - Number(y.virtual) || score(y.address) - score(x.address));
  return out;
}

function score(ip) {
  if (/^192\.168\./.test(ip)) return 3;
  if (/^10\./.test(ip)) return 2;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 1;
  return 0;
}

module.exports = { lanAddresses };
