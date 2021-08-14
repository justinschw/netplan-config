# netplan-config
NPM wrapper that provides Linux network configuration using netplan

This is inspired by fgribreau's **network-config** package. This module has the same goals, but using netplan and ip instead of the outdated ifconfig and /etc/network/interfaces.

**Netplan info and examples:** https://netplan.io/examples/

## Installation

```
npm i netplan-config
```

## Example usage

```
const Netplan = require('netplan-config');

// Initialize
const net = new Netplan();

/*  If /etc/netplan/config.yanml is present, you may want to load it first
 *  before making changes.
 *  If you just want to create a new config from scratch and define all
 *  the interfaces, don't bother with this.
 */
net.loadConfig()

// Configure eth0 as a DHCP WAN interface
net.configureInterface('eth0', {
  dhcp: true
});

// Configure eth0 as a static WAN interface
net.configureInterface('eth0', {
  ip: '192.168.4.8',
  defaultGateway: '192.168.4.1',
  nameservers: ['192.168.4.1'],
  domain: 'guardian-angel.local'
});

// Configure eth0 as a static LAN interface
net.configureInterface('eth0', {
  ip: '192.168.4.8'
});

/*  Configure wlan0 as a static LAN interface so that I can run hostapd
 *  on it.
 *  Use 255.255.0.0 (/16) subnet
*/
net.configureInterface('wlan0', {
  ip: '192.168.0.1',
  prefix: 16
});

// Configure wlan0 as a DHCP WAN interface
net.configureInterface('wlan0', {
  dhcp: true,
  accessPoint: {
    ssid: 'TellMyWiFiLoveHer',
    wifiPassword: 'supersecretpassword'
  }
});

// Configure wlan0 as a static IP WAN interface
net.configureInterface('wlan0', {
  dhcp: false,
  ip: '192.168.1.1',
  nameservers: ['192.168.1.1'],
  defaultGateway: '192.168.1.1',
  accessPoint: {
    ssid: 'TellMyWiFiLoveHer',
    wifiPassword: 'supersecretpassword'
  }
});

/* Now that I have made up my mind, don't forget to write back to
 * /etc/netplan/config.yaml
 */
net.writeConfig();

// I am now ready to apply.
net.apply().then(result => {
  console.log(`Successfully returned code=${result.code}`);
}).catch(err => {
  console.error('Uh oh, something went wrong.');
});

/*  The changes are now in the system!
 *  I can get all the IP information for every interface
 * by calling this:
 */
net.status().then(status => {
  console.log(status);
});

/********************************************************
OUTPUT:
{
  lo: {
    type: 'loopback',
    mac: '00:00:00:00:00:00',
    ipv4: { ip: '127.0.0.1', prefix: 8 },
    ipv6: { ip: '::1', prefix: 128 }
  },
  eno1: {
    type: 'ether',
    mac: 'aa:bb:cc:dd:ee:ff',
    ipv4: {
      ip: '192.168.4.8',
      broadcast: '192.168.4.255',
      prefix: 24,
    },
    ipv6: { ip: 'fe80::4639:c4ff:fe54:dbd3', prefix: 64 }
  },
  wlan0: {
    type: 'ether',
    mac: 'ff:ee:dd:cc:bb:aa',
    ipv4: {
      ip: '192.168.1.67',
      broadcast: '192.168.1.255',
      prefix: 24,
      gateway: '192.168.1.1'
    }
  }
}
********************************************************/
```

## Advanced config
If you are too good and fancy to use my simple configureInterface method above, then you can provide your own custom netplan config.

For example, maybe you want to use NetworkManager instead of networkd for your renderer:
```
const net = new Netplan({
  network: {
    version: 2,
    renderer: 'NetworkManager'
  }
});
```

Also if you want to write a custom interface your own way, you can use netplan's format and create it using configureNetplanInterface:
```
net.configureNetplanInterface({
  name: 'eth0',
  type: 'wifi',
  definition: {
    // netplan format interface definition here
    dhcp4: true,
    'access-points': {
      'TellMyWiFiLoveHer': {
        password: 'supersecretpassword'
      }
    }
  }
});
```

Happy configging!