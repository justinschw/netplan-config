'use strict';
const joi = require('joi');
const yaml = require('yaml');
const fs = (process.env.TESTENV) ? require('memfs') : require('fs');
const path = require('path');
const {spawn} = require('child_process');

function Netplan(config) {
    const schema = joi.object({
        network: joi.object({
            version: joi.number().default(2),
            renderer: joi.string().valid('networkd', 'NetworkManager').default('networkd'),
            ethernets: joi.object().optional(), // This can be defined later
            wifis: joi.object().optional() // This can be defined later
        }).default(),
        configFile: joi.string().regex(/^(\/[^\/ ]*)+\/?$/).default('/etc/netplan/config.yaml')
    });
    const input = config || {};
    const validated = joi.attempt(input, schema);
    this.plan = {
        network: validated.network
    };
    this.configFile = validated.configFile;

    // Accommodate /sbin and /usr/sbin in path
    let paths = new Set(process.env.PATH.split(':'));
    paths.add('/sbin');
    paths.add('/usr/sbin')

    this.binary = null;
    this.ipBinary = null;
    this.routeBinary = null;
    paths.forEach(binPath => {
        if (fs.existsSync(path.join(binPath, 'netplan'))) {
            this.binary = path.join(binPath, 'netplan');
        }
        if (fs.existsSync(path.join(binPath, 'ip'))) {
            this.ipBinary = path.join(binPath, 'ip');
        }
        if (fs.existsSync(path.join(binPath, 'route'))) {
            this.routeBinary = path.join(binPath, 'route');
        }
    });
    this.oldConfig = '';
    this.newConfig = '';
}

Netplan.prototype.readConfigFile = function(filepath) {
    const data = fs.readFileSync(filepath, 'utf8');
    let map = {};
    data.split('\n').forEach(line => {
        if (line.indexOf('=') >= 0) {
            const parts = line.split('=');
            map[parts[0]] = parts[1];
        }
    });
    return map;
}

/*
 * Load the current configuration file
 */
Netplan.prototype.loadConfig = function() {
    if (fs.existsSync(this.configFile)) {
        const contents = fs.readFileSync(this.configFile, 'utf8');
        this.plan = yaml.parse(contents);
    }
};

/*
 * Write current config to netplan config file
 */
Netplan.prototype.writeConfig = function() {
    if (fs.existsSync(this.configFile)) {
	this.oldConfig = fs.readFileSync(this.configFile, 'utf-8');
    }
    const yamlDoc = new yaml.Document();
    yamlDoc.contents = this.plan;
    this.newConfig = yamlDoc.toString();

    // Write this to the configuration file
    if (this.oldConfig !== this.newConfig) {
        fs.writeFileSync(this.configFile, this.newConfig);
    }
}

/*
 * Provide custom interface config using the netplan format
 */
Netplan.prototype.configureNetplanInterface = function(options) {
    const schema = joi.object({
        name: joi.string().min(1).required(),
        type: joi.string().valid('ethernet', 'wifi').default('ethernet'),
        definition: joi.object().required()
    });
    let validated = joi.attempt(options, schema);

    if (validated.type === 'ethernet') {
        this.plan.network.ethernets = this.plan.network.ethernets || {};
        this.plan.network.ethernets[validated.name] = validated.definition;
    } else if (validated.type === 'wifi') {
        this.plan.network.wifis = validated.wifis || {};
        this.plan.network.wifis[validated.name] = validated.definition;
    } else {
        throw new Error(`Unsupported interface type: ${validated.type}`);
    }
};

/*
 * The following are some easy-to-use prepackaged methods for configuring typical network interfaces
 */
function addAccessPoint(definition, accessPoint) {
    definition['access-points'] = {};
    definition['access-points'][accessPoint.ssid] = {
        password: accessPoint.wifiPassword
    };
}

Netplan.prototype.configureInterface = function(name, options) {
    const schema = joi.object({
        dhcp: joi.boolean().default(false),
        ip: joi.string().ip().optional(),
        prefix: joi.number().min(0).max(32).default(24),
        defaultGateway: joi.string().ip().optional(),
        domain: joi.string().domain().optional(),
        nameservers: joi.array().items(joi.string().ip()).optional(),
        accessPoint: joi.object({
            ssid: joi.string().min(1).required(),
            wifiPassword: joi.string().min(1).required()
        }).optional()
    });
    const validated = joi.attempt(options, schema);

    let definition = {
        ...validated.dhcp && {dhcp4: 'yes'},
        ...(!validated.dhcp && validated.ip) && {addresses: [`${validated.ip}/${validated.prefix}`]},
        ...(!validated.dhcp && validated.nameservers) && {
            nameservers: {
                ...validated.domain && {search: [validated.domain]},
                addresses: validated.nameservers
            }
        },
        ...(!validated.dhcp && validated.defaultGateway) && {
            routes: [
                {
                    to: '0.0.0.0/0',
                    via: validated.defaultGateway
                }
            ]
        }
    }

    let type = 'ethernet';
    if (validated.accessPoint) {
        addAccessPoint(definition, validated.accessPoint);
        type = 'wifi';
    }

    this.configureNetplanInterface({
        name,
        type,
        definition
    });
};

/*
 * Netplan execution method
 */
Netplan.prototype.executeBinary = function(binPath, args) {
    const netplan = this;
    return new Promise(function(resolve, reject) {
        if (!binPath) {
            return reject(new Error('netplan binary not found'));
        }
        const netplanResult = spawn(binPath, args);
        let result = {};

        netplanResult.stdout.on('data', (data) => {
            result.stdout = data.toString('utf8').trim();
        });

        netplanResult.stderr.on('data', (data) => {
            result.stderr = data.toString('utf8').trim();
        });

        netplanResult.on('close', (code) => {
            result.code = code;
            if (code !== 0) {
                let error = new Error(`netplan failed with code ${code} using args args '${args}'`);
                error.stdout = result.stdout;
                error.stderr = result.stderr;
                error.code = code;
                return reject(error);
            } else {
                return resolve(result);
            }
        });
    });
};

function parseIP(info, family) {
    let ipInfo = info.find(i => i.family === family);
    if (ipInfo) {
        return {
            ...ipInfo.local && {ip: ipInfo.local},
            ...ipInfo.broadcast && {broadcast: ipInfo.broadcast},
            ...ipInfo.prefixlen && {prefix: ipInfo.prefixlen}
        }
    } else {
        return null;
    }
}

Netplan.prototype.status = async function() {
    const ipResult = await this.executeBinary(this.ipBinary, ['-j', 'addr']);
    const routeResult = await this.executeBinary(this.routeBinary, ['-n']);
    let route6Result = null;
    try {
        route6Result = await this.executeBinary(this.routeBinary, ['-6n']);
    } catch (err) {
        // Nothing to do; no IPv6 routes
    }
    let status = {};
    let currentIf;
    // Parse IP info
    if (ipResult.stdout) {
        const ipJson = JSON.parse(ipResult.stdout);
        ipJson.forEach(iface => {
            let ip4Info = parseIP(iface.addr_info, 'inet');
            let ip6Info = parseIP(iface.addr_info, 'inet6');
            status[iface.ifname] = {
                ...iface.link_type && {type: iface.link_type},
                ...iface.address && {mac: iface.address},
                ...ip4Info && {ipv4: ip4Info},
                ...ip6Info && {ipv6: ip6Info}
            };
        })
        ipResult.stdout.split('\n').forEach(line => {
            if (line.match(/^[0-9]+\:/)) {
                // This is an interface line
                const parts = line.split(':');
                currentIf = parts[1].trim()
                status[currentIf] = {}
            } else if (line.trim().match(/^link\//)){
                let l2line = line.trim().split(' ');
                if(currentIf) {
                    status[currentIf].type = l2line[0].split('/')[1];
                    status[currentIf].mac = l2line[1];
                }
            } else if (line.trim().match(/^inet\s/)) {
                let ip4line = line.trim().split(' ');
                if (currentIf) {
                    status[currentIf].ipv4 = {};
                    for(let i = 0; i < ip4line.length; i++) {
                        if (ip4line[i] === 'inet') {
                            const parts = ip4line[i+1].split('/');
                            status[currentIf].ipv4.ip = parts[0];
                            status[currentIf].ipv4.prefix = parts[1];
                        } else if (ip4line[i] === 'brd') {
                            status[currentIf].ipv4.broadcast = ip4line[i+1];
                        }
                    }
                }
            } else if (line.trim().match(/^inet6\s/)) {
                let ip6line = line.trim().split(' ');
                if (currentIf) {
                    status[currentIf].ipv6 = {};
                    for(let i = 0; i < ip6line.length; i++) {
                        if (ip6line[i] === 'inet6') {
                            const parts = ip6line[i+1].split('/');
                            status[currentIf].ipv6.ip = parts[0];
                            status[currentIf].ipv6.prefix = parts[1];
                        } else if (ip6line[i] === 'brd') {
                            status[currentIf].ipv6.broadcast = ip6line[i+1];
                        }
                    }
                }
            }
        });
    }
    // Parse IPv4 route info
    if (routeResult.stdout) {
        let header = [];
        routeResult.stdout.split('\n').forEach(route => {
            let columns = route.trim().replace(/\s+/g, ' ').split(' ');
            if (route.trim().match(/Destination/)) {
                header = columns;
            }
            if (route.trim().match(/^0.0.0.0/)) {
                // This is a default route
                const gwIndex = header.indexOf('Gateway');
                const ifIndex = header.indexOf('Iface');
                if (ifIndex >= 0 && gwIndex >= 0) {
                    let gateway = columns[gwIndex];
                    let iface = columns[ifIndex];
                    if (status[iface] && status[iface].ipv4) {
                        status[iface].ipv4.gateway = gateway;
                    }
                }
            }
        });
    }

    // Parse IPv6 route info
    if (route6Result.stdout) {
        let header = [];
        route6Result.stdout.split('\n').forEach(route => {
            route = route.replace('Next Hop', 'Next_Hop');
            let columns = route.trim().replace(/\s+/g, ' ').split(' ');
            if (route.trim().match(/Destination/)) {
                header = columns;
            }
            if (route.trim().match(/^\:\:\/0/)) {
                // This is a default route
                const gwIndex = header.indexOf('Next_Hop');
                const ifIndex = header.indexOf('If');
                if (ifIndex >= 0 && gwIndex >= 0) {
                    let gateway = columns[gwIndex];
                    let iface = columns[ifIndex];
                    if (status[iface] && status[iface].ipv6 && gateway !== '::') {
                        status[iface].ipv6.gateway = gateway;
                    }
                }
            }
        });
    }

    return status;
};

/*
 * Generate backend configs
 */
Netplan.prototype.generate = function() {
    return this.executeBinary(this.binary, ['generate']);
};

/*
 * Apply the changes
 */
Netplan.prototype.apply = function(force = true) {
    if (force || (this.oldConfig !== this.newConfig)) {
        return this.executeBinary(this.binary, ['apply']);
    }
    else {
        return Promise.resolve();
    }
};

module.exports = Netplan;
